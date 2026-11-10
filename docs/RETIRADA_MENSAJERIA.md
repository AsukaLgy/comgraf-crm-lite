# Actualización del perfil ligero: solicitudes y notas
> **Guía vigente:** [Operación](OPERACION.md) contiene el procedimiento actual de actualización, respaldo y diagnóstico para `/opt/comgraf-beta/lite`. Este documento conserva el contexto de la intervención que describe.


Esta versión conserva clientes, solicitudes, cotizaciones, varias OP, producción, QR, entregas, cobros, calendario, adjuntos y usuarios. Retira el envío, recepción, configuración, sincronización y reintento de correo, además del registro nuevo de WhatsApp. Los mensajes, cuentas, borradores y claves anteriores permanecen. La única migración nueva, `014_nullable_case_origin`, permite `NULL` en `cases.channel`; no actualiza filas existentes ni borra tablas. El campo histórico `pending_message` deja de bloquear cierre o bandejas porque ya no existe una acción de mensajería para resolverlo. Las tareas y demás criterios permanecen.

Estas instrucciones son para una instalación existente del perfil `comgraf-lan-light`. No ejecutan nada automáticamente. Haz la preparación en un equipo con Docker Linux y conserva el checkout, `.runtime/low-resource/.env`, directorios de datos y volúmenes del servidor. No uses `docker compose down -v`, no inicialices MySQL y no recrees `db` ni `https_proxy`.

## 1. Preparar la imagen en otro equipo

Parte del commit revisado de esta actualización y de un árbol limpio. El Dockerfile y las versiones de Python, MySQL y Caddy permanecen iguales. Construye la imagen y transfiere el archivo por un medio confiable:

```sh
git status --short
git rev-parse HEAD
docker build --platform linux/amd64 -f Dockerfile -t comgraf-app:sin-mensajeria .
docker image inspect comgraf-app:sin-mensajeria --format '{{.Architecture}} {{.Os}}'
docker save -o comgraf-app-sin-mensajeria.tar comgraf-app:sin-mensajeria
sha256sum comgraf-app-sin-mensajeria.tar
scp comgraf-app-sin-mensajeria.tar USUARIO@SERVIDOR:/tmp/
```

Conserva el hash para verificarlo en el servidor. `linux/amd64` no demuestra compatibilidad con el Core 2 Duo; el arranque y flujo real deben comprobarse allí. En este repositorio el perfil nuevo elimina flags de mensajería, pero una instalación anterior puede conservar su `compose.low-resource.yaml`: la nueva aplicación ignora esos flags y no necesita modificar el checkout del servidor para actualizar solo `app`.

## 2. Detener escrituras y respaldar en el servidor

En el servidor, revisa el estado y el espacio disponible. Ajusta la ruta del respaldo a un disco protegido con capacidad suficiente. Mantén la aplicación detenida desde el respaldo hasta activar la nueva imagen, para que SQL y adjuntos correspondan al mismo momento.

```sh
cd /opt/comgraf-beta/lite
sha256sum /tmp/comgraf-app-sin-mensajeria.tar
scripts/low-resource-compose.sh ps
set -a
. ./.runtime/low-resource/.env
set +a
BACKUP="/opt/comgraf-beta/backups/sin-mensajeria-$(date +%Y%m%d-%H%M%S)"
mkdir -p -m 700 "$BACKUP"
cp .runtime/low-resource/.env "$BACKUP/runtime.env"
cp compose.low-resource.yaml "$BACKUP/compose.low-resource.yaml"
docker tag comgraf-app:lan-low-resource comgraf-app:antes-sin-mensajeria
scripts/low-resource-compose.sh stop app
scripts/low-resource-compose.sh exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump --protocol=socket -uroot --single-transaction --routines --events --triggers --databases "$MYSQL_DATABASE"' > "$BACKUP/mysql.sql"
tar -C "$APP_DATA_DIR" -czf "$BACKUP/files.tar.gz" uploads mail-secrets
chmod 600 "$BACKUP"/*
```

Verifica que `mysql.sql` y `files.tar.gz` no estén vacíos y guarda una copia fuera del servidor. El archivo `runtime.env`, SQL y la clave de correo histórica son secretos. Los volúmenes de Caddy y certificados no se recrean ni modifican; conserva también su respaldo operativo habitual. Si falla el respaldo, vuelve a iniciar la imagen anterior con `scripts/low-resource-compose.sh start app` y detén la actualización.

## 3. Reemplazar solo la imagen de `app`

```sh
cd /opt/comgraf-beta/lite
docker load -i /tmp/comgraf-app-sin-mensajeria.tar
docker tag comgraf-app:sin-mensajeria comgraf-app:lan-low-resource
scripts/low-resource-compose.sh up -d --no-deps --no-build --force-recreate app
scripts/low-resource-compose.sh ps
scripts/low-resource-compose.sh logs --tail=100 app
```

El arranque aplica la migración 014 antes de servir HTTP. Verifica `/api/health`, inicio de sesión, los tres tipos nuevos, una solicitud antigua, una nota, un adjunto histórico, cotización, OP, ficha de impresión y QR con cuentas apropiadas. Comprueba que no haya proceso de correo ni conexión SMTP/IMAP. Los mensajes `Pendiente` siguen pendientes; el sistema no los envía. Revisa también `alembic_version` y `cases.channel` con una cuenta administrativa si necesitas confirmar el esquema. No afirmes compatibilidad física hasta completar estas comprobaciones en el NAS.

## 4. Reversión

La imagen anterior no conoce la revisión Alembic 014. **No basta con cambiar la etiqueta de la imagen:** su arranque fallaría al leer esa revisión. La reversión segura y reproducible usa el respaldo conjunto tomado antes de la actualización; cualquier registro creado después se perderá. Conserva una copia del estado actual antes de restaurar si necesitas analizarlo o recuperar datos manualmente más tarde.

```sh
cd /opt/comgraf-beta/lite
scripts/low-resource-compose.sh stop app
set -a
. ./.runtime/low-resource/.env
set +a
# Sustituye RUTA_RESPALDO por el directorio verificado del paso 2.
BACKUP=RUTA_RESPALDO
scripts/low-resource-compose.sh exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --protocol=socket -uroot' < "$BACKUP/mysql.sql"
tar -C "$APP_DATA_DIR" -xzf "$BACKUP/files.tar.gz"
cp "$BACKUP/compose.low-resource.yaml" compose.low-resource.yaml
docker tag comgraf-app:antes-sin-mensajeria comgraf-app:lan-low-resource
scripts/low-resource-compose.sh up -d --no-deps --no-build --force-recreate app
scripts/low-resource-compose.sh ps
scripts/low-resource-compose.sh logs --tail=100 app
```

Restaura `runtime.env` solo si se modificó por separado; esta actualización no lo cambia. Verifica salud, cuentas, número de solicitudes, saldos, adjuntos y certificados. La clave histórica y las credenciales permanecen en los mismos volúmenes. No ejecutes `alembic downgrade` sobre una base que ya tenga solicitudes con canal nulo: la migración lo rechaza para evitar inventar un origen.
