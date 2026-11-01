# Pausa de canales en la beta ligera

> Documento histórico del commit `9619b4f`. La versión actual retiró la mensajería y no admite su reactivación por configuración. Para actualizar una instalación existente, usa [RETIRADA_MENSAJERIA.md](RETIRADA_MENSAJERIA.md). No apliques los pasos de reactivación de este documento a la versión nueva.

Esta actualización conserva MySQL, adjuntos, borradores, mensajes, claves, cuentas, historial, Caddy y los límites del perfil ligero. No añade migraciones ni cambia versiones de Python, MySQL o Caddy. `MAIL_CHANNEL_ENABLED=false` impide conexiones, pruebas, sincronización y envíos de correo desde HTTP, transporte y trabajador; `MAIL_WORKER_ENABLED=false` detiene el proceso. Los correos ya vinculados a una solicitud pueden marcarse como atendidos localmente para no bloquear su cierre. `WHATSAPP_CHANNEL_ENABLED=false` oculta su borrador y registro manual en la interfaz, sin alterar el canal de origen de solicitudes ni interacciones existentes. Los envíos pendientes quedan en su estado actual. **Revisa cada envío pendiente y los resultados inciertos antes de reactivar el trabajador**, para evitar envíos tardíos o duplicados.

Los siguientes pasos se preparan para `/opt/comgraf-beta/lite`. No se ejecutan automáticamente. Sustituye `USUARIO@SERVIDOR` por la cuenta SSH y usa un directorio de respaldo con espacio suficiente y acceso restringido. El archivo `.runtime/low-resource/.env` existente se conserva.

## 1. Laptop: construir y transferir

Desde la raíz de este repositorio, con Docker Desktop en modo Linux:

```powershell
docker build --platform linux/amd64 -f Dockerfile -t comgraf-app:lan-low-resource-channel-pause-20261101 .
docker image inspect comgraf-app:lan-low-resource-channel-pause-20261101 --format '{{.Architecture}} {{.Os}}'
docker save -o comgraf-app-channel-pause-20261101.tar comgraf-app:lan-low-resource-channel-pause-20261101
git diff --binary e4b5c32 HEAD --output=channel-pause-20261101.patch
Get-FileHash .\comgraf-app-channel-pause-20261101.tar -Algorithm SHA256
Get-FileHash .\channel-pause-20261101.patch -Algorithm SHA256
scp .\comgraf-app-channel-pause-20261101.tar .\channel-pause-20261101.patch USUARIO@SERVIDOR:/tmp/
```

El Dockerfile fija las bases existentes y compila las ruedas con objetivo x86-64 básico. `linux/amd64` por sí mismo no prueba la compatibilidad con el Core 2 Duo; confirma el arranque en ese equipo antes de dar por terminada la actualización. El parche contiene los cambios confirmados en Git desde `e4b5c32`, incluido `compose.low-resource.yaml`; comprueba que el servidor esté en ese commit y que no haya cambios ajenos antes de aplicarlo. Conserva los hashes obtenidos en la laptop para comparar en el servidor. `git pull` solo actualiza archivos del checkout: no cambia el código ya incluido en una imagen Docker.

## 2. Servidor: verificar y respaldar

Ejecuta en la terminal Linux del servidor. El respaldo se crea fuera del checkout; almacena otra copia fuera del equipo y protege el SQL, `.env` y la clave de correo.

```sh
cd /opt/comgraf-beta/lite
sha256sum /tmp/comgraf-app-channel-pause-20261101.tar /tmp/channel-pause-20261101.patch
git status --short
git rev-parse --short HEAD  # Debe mostrar e4b5c32
git apply --check /tmp/channel-pause-20261101.patch
BACKUP="/opt/comgraf-beta/backups/channel-pause-$(date +%Y%m%d-%H%M%S)"
mkdir -p -m 700 "$BACKUP"
set -a
. ./.runtime/low-resource/.env
set +a
scripts/low-resource-compose.sh stop app
scripts/low-resource-compose.sh exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump --protocol=socket -uroot --single-transaction --routines --events --triggers --databases "$MYSQL_DATABASE"' > "$BACKUP/mysql.sql"
tar -C "$APP_DATA_DIR" -czf "$BACKUP/files.tar.gz" uploads mail-secrets
cp .runtime/low-resource/.env "$BACKUP/runtime.env"
chmod 600 "$BACKUP"/*
scripts/low-resource-compose.sh start app
docker tag comgraf-app:lan-low-resource comgraf-app:lan-low-resource-before-channel-pause-20261101
docker image inspect comgraf-app:lan-low-resource-before-channel-pause-20261101 --format '{{.Id}}'
```

Si falla el respaldo, no continúes. La imagen anterior queda etiquetada para volver atrás. No uses `docker compose down -v`, no inicialices el entorno y no regeneres credenciales.

## 3. Servidor: actualizar solo la aplicación

```sh
cd /opt/comgraf-beta/lite
git apply /tmp/channel-pause-20261101.patch
scripts/low-resource-compose.sh config --quiet
docker load -i /tmp/comgraf-app-channel-pause-20261101.tar
docker tag comgraf-app:lan-low-resource-channel-pause-20261101 comgraf-app:lan-low-resource
scripts/low-resource-compose.sh up -d --no-deps --no-build --force-recreate app
scripts/low-resource-compose.sh ps
scripts/low-resource-compose.sh logs --tail=100 app
```

Comprueba `/api/health`, inicio de sesión, una solicitud existente con historial, nota, orden, impresión y escaneo con cuentas de prueba apropiadas. No pulses envío ni prueba de correo. MySQL y `https_proxy` no se recrean. La aplicación ejecuta Alembic al arrancar; esta actualización no agrega migraciones.

## 4. Volver a la imagen anterior

Si necesitas regresar, conserva los datos nuevos y usa la etiqueta de respaldo; no restaures el SQL salvo que exista un motivo de recuperación de datos independiente. El código anterior ignora las nuevas variables de canal, por lo que reaparecerá la interfaz anterior.

```sh
cd /opt/comgraf-beta/lite
docker tag comgraf-app:lan-low-resource-before-channel-pause-20261101 comgraf-app:lan-low-resource
scripts/low-resource-compose.sh up -d --no-deps --no-build --force-recreate app
scripts/low-resource-compose.sh ps
scripts/low-resource-compose.sh logs --tail=100 app
```

Para revertir también los archivos del checkout, tras comprobar que no hay cambios posteriores, ejecuta `git apply --reverse --check /tmp/channel-pause-20261101.patch` y luego `git apply --reverse /tmp/channel-pause-20261101.patch`. No cambies la configuración local de Caddy ni sus volúmenes/certificados.

## Reactivar en el futuro

Primero revisa en MySQL y con el personal los mensajes `Pendiente`, `Enviando`, `Pausado`, `Error` y `Resultado incierto`, junto con copias en Enviados pendientes; confirma cuáles deben enviarse y cuáles ya pudieron aceptarse. Esta consulta es solo de lectura y omite cuerpos y destinatarios:

```sh
cd /opt/comgraf-beta/lite
scripts/low-resource-compose.sh exec -T db sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql --protocol=TCP -h 127.0.0.1 -u"$MYSQL_USER" -D"$MYSQL_DATABASE"' <<'SQL'
SELECT id, case_id, status, sent_copy_status, send_attempts, created_at
FROM mail_messages
WHERE direction = 'Saliente'
  AND (status IN ('Pendiente', 'Enviando', 'Pausado', 'Error', 'Resultado incierto')
       OR sent_copy_status IN ('Pendiente', 'Error'))
ORDER BY created_at, id;
SQL
```

Haz un respaldo. Después cambia `MAIL_CHANNEL_ENABLED` a `true` en `compose.low-resource.yaml` y recrea solo `app` con `scripts/low-resource-compose.sh up -d --no-deps --no-build --force-recreate app`. Configura o comprueba la cuenta en el CRM. Activa `MAIL_WORKER_ENABLED=true` y recrea `app` solo cuando la cola esté revisada. WhatsApp sigue sin envío integrado; `WHATSAPP_CHANNEL_ENABLED=true` únicamente vuelve a mostrar borrador y registro manual.
