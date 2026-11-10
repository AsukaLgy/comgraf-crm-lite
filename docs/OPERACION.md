# Operación de COMGRAF CRM

Esta es la guía vigente para desarrollo, actualización y recuperación. El servidor de la imprenta usa el perfil `compose.low-resource.yaml`, el wrapper `scripts/low-resource-compose.sh` y el checkout `/opt/comgraf-beta/lite`. Los documentos de migraciones anteriores describen decisiones históricas; no son instrucciones alternativas para actualizar esa instalación.

## Mapa del proyecto

| Ruta | Responsabilidad |
| --- | --- |
| `frontend/src/` | React; `App.jsx` enruta y controla la navegación, `domain.js` mantiene etiquetas y opciones, `api.js` concentra contrato HTTP, fechas y moneda. `CasePage.jsx` coordina el detalle; `CasePrintSheet.jsx` y `PrintDocument.jsx` comparten la ficha y aíslan la impresión. |
| `backend/app/routers/` | Endpoints FastAPI, autenticación y permisos de entrada. |
| `backend/app/services.py`, `deletion.py` | Reglas de negocio, transacciones, concurrencia, eventos y eliminación definitiva. |
| `backend/app/repository.py`, `models.py`, `schemas.py` | Consultas y proyecciones, tablas SQLAlchemy, validación Pydantic. |
| `backend/migrations/versions/` | Revisiones Alembic incrementales; las aplicadas no se editan ni borran. |
| `backend/tests/`, `frontend/e2e/` | Pruebas MySQL con datos ficticios y recorridos de navegador. |
| `scripts/`, `docker/` | Arranque, respaldo, diagnóstico y perfil de contenedores. |

React llama a `/api` en el mismo origen; FastAPI consulta MySQL. La imagen Docker compila los recursos frontend y los sirve junto a la API. Para cambiar una operación, modifica contrato Pydantic, regla de servicio, endpoint y formulario, y añade pruebas de autorización/concurrencia. Las etiquetas visibles de etapa están en `frontend/src/domain.js` y `backend/app/schemas.py`; los códigos internos permanecen estables. Las migraciones se crean en `backend/` con `alembic revision -m "descripción"`, se revisan manualmente, se prueban con `alembic upgrade head` y `alembic check` **solo en una base aislada** antes de publicarse. El arranque `python -m app.start` aplica revisiones pendientes.

## Desarrollo reproducible

Requisitos: Python 3.14, Node 24, MySQL 8.4 y Docker Compose v2 si se usa contenedor. Node 18 permitió una compilación local, pero Vite y React Router declaran Node 20.19+; usa Node 24 para resultados reproducibles. No existe usuario ni contraseña predeterminados.

1. Crea una base aislada con nombre terminado en `_test` y una cuenta MySQL de desarrollo. Copia `.env.example` a `.env` solo en la estación de desarrollo y configura credenciales y rutas. `.env`, `.runtime` y adjuntos están excluidos de Git; no los pegues en incidencias.
2. Instala dependencias bloqueadas desde la raíz:

   ```sh
   python3.14 -m venv .venv
   .venv/bin/python -m pip install -r backend/requirements.lock.txt
   .venv/bin/python -m pip install -r backend/requirements-dev.txt
   npm --prefix frontend ci --ignore-scripts
   ```

3. Desde `backend/`, con `MYSQL_DATABASE` apuntando **solo** a la base de desarrollo, ejecuta `../.venv/bin/python -m alembic upgrade head`. Para la primera cuenta usa `../.venv/bin/python -m app.cli create-admin`; solicita la contraseña sin mostrarla. Inicia la API con `APP_HOST=127.0.0.1 APP_WORKERS=1 ../.venv/bin/python -m app.start`.
4. En otra terminal ejecuta `npm --prefix frontend run dev`. Vite reenvía `/api` al proceso Python. Para servir la compilación desde Python, usa `npm --prefix frontend run build`.

Pruebas y comprobaciones:

```sh
cd backend
TEST_MYSQL_DATABASE=comgraf_delete_test ../.venv/bin/python -m pytest -q
../.venv/bin/python -m ruff check app tests ../scripts
cd ../frontend
npm run lint
npm run build
```

`conftest.py` rechaza bases sin sufijo `_test`; las pruebas borran **solo** registros de esa base. Los smoke tests de `frontend/e2e/*.mjs` usan respuestas ficticias y un servidor estático de `frontend/dist` en `127.0.0.1:4173`. La suite Playwright completa requiere una instancia que apunte a una base `_test` y las credenciales ficticias generadas por `backend/tests/seed_e2e.py`; nunca se ejecuta contra producción. `npm run format:check` aún detecta formato heredado en archivos existentes; no mezcles una reformateación masiva con cambios de negocio.

## Actualizar `/opt/comgraf-beta/lite`

Las siguientes acciones son **manuales** y requieren ventana de mantenimiento. No se ejecutan al consultar esta guía. Mantén la configuración local, Caddy, Tailscale y los volúmenes. El diagnóstico de solo lectura funciona desde cualquier directorio:

```sh
/opt/comgraf-beta/lite/scripts/diagnose-deployment.sh
```

1. **Revisa el punto de partida.** En `/opt/comgraf-beta/lite`, ejecuta `git branch --show-current`, `git rev-parse HEAD`, `git status --short` y el diagnóstico. Si hay cambios locales, comprende cada uno antes de continuar. El archivo `.runtime/low-resource/.env` es local y no debe reemplazarse.
2. **Respalda antes de migrar.** Detén `app` durante la copia consistente y conserva por separado SQL, adjuntos y configuración; sigue la sección siguiente. Verifica los archivos y una restauración aislada antes de avanzar.
3. **Descarga y compara.** `git fetch origin`; revisa `git log --oneline HEAD..origin/feat/order-print-preview` y `git diff --stat HEAD..origin/feat/order-print-preview`. Compara también `compose.low-resource.yaml` con el destino. `git fetch` no modifica el árbol de trabajo.
4. **Incorpora sin perder ajustes.** `git merge --ff-only origin/feat/order-print-preview` puede abortar si `compose.low-resource.yaml` tiene cambios locales. No uses `reset --hard`. Guarda `cp compose.low-resource.yaml "$BACKUP/compose.low-resource.yaml"` y `git diff -- compose.low-resource.yaml > "$BACKUP/compose.local.patch"` en un directorio protegido. Traslada cada ajuste particular a un override local según la sección siguiente. Solo después de verificar esa copia y el override, devuelve **ese archivo versionado** a HEAD con `git restore --source=HEAD -- compose.low-resource.yaml` y comprueba que la configuración efectiva conserva los ajustes; entonces repite el avance rápido. Si quedan otros cambios, resuélvelos explícitamente o guárdalos en un stash identificado y aplica el stash **sin borrarlo** después del avance. Si aparece un conflicto, compara el archivo nuevo, el parche y el override, resuélvelo manualmente y conserva la copia hasta verificar la aplicación. No mezcles ramas con un merge automático si el árbol aún contiene cambios sin evaluar.
5. **Construye desde el commit elegido.** Comprueba `git status --short` y el commit. Si el árbol contiene cambios de código sin commit, no anuncies su HEAD como commit de construcción. Con un checkout revisado, ejecuta:

   ```sh
   BUILD_COMMIT="$(git rev-parse HEAD)" BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)" scripts/low-resource-compose.sh build app
   ```

6. **Recrea solo `app`.** `scripts/low-resource-compose.sh up -d --no-deps --force-recreate app`. No uses `down -v`, ni recrees `db` o `https_proxy` como parte de una actualización de aplicación. `app.start` aplica Alembic antes de servir tráfico.
7. **Verifica cuatro capas distintas.** `git rev-parse HEAD` describe el código local; la etiqueta de imagen puede apuntar a una imagen nueva; el contenedor puede seguir ejecutando otra; `/api/version` describe el proceso que responde. Ejecuta `scripts/diagnose-deployment.sh`, `scripts/low-resource-compose.sh ps` y `scripts/low-resource-compose.sh logs --tail=100 app`. Comprueba salud, `product_version`, `commit`, `build_date`, y que el ID de imagen disponible coincide con el ejecutado. El campo legado `build` no identifica el commit.
8. **Comprueba el acceso.** Abre la URL HTTPS local habitual y, por separado, la ruta aprobada por Tailscale; comprueba inicio de sesión, una solicitud y una OP de prueba **sin eliminar ni modificar registros reales**. Si solo falla Tailscale, revisa `tailscale status`, nombre/IP de tailnet, ruta y certificado; si falla localmente también, revisa contenedor, Caddy, healthcheck y logs. No cambies rutas, puertos o certificados como parte de este diagnóstico.

### Ajustes locales de Compose sin conflictos futuros

El wrapper usa solo `compose.low-resource.yaml` por defecto, igual que antes. Opcionalmente acepta `LOW_RESOURCE_OVERRIDE_FILE` desde el entorno de la orden o desde `.runtime/low-resource/.env`; la variable de la orden tiene prioridad. Añade el override **después** del archivo base, de modo que sus claves prevalecen según las reglas de Compose. Un archivo ausente produce error antes de invocar Docker. No se crean puertos ni volúmenes nuevos automáticamente.

Para migrar manualmente ajustes de un `compose.low-resource.yaml` modificado, compara el archivo con Git, crea un YAML local bajo `.runtime/low-resource/` que contenga solo las diferencias necesarias, añade su ruta absoluta como `LOW_RESOURCE_OVERRIDE_FILE=...` al `.env` local y prueba `scripts/low-resource-compose.sh config --quiet`. Revisa la configuración efectiva **sin compartir su salida completa**: Compose puede incluir secretos. Luego retira del archivo versionado únicamente los ajustes que ya verificaste en el override, conserva la copia y vuelve a comprobar `git status`. No uses un override para cambiar a ciegas montajes, puertos o límites de recursos.

## Respaldo y recuperación

SQL y adjuntos son respaldos diferentes; guarda también `.runtime/low-resource/.env` con permisos restrictivos y copias externas al disco del servidor. Usa el wrapper para entrar a `db`; las contraseñas vienen de su entorno y no aparecen en el comando. En el contenedor, usa MySQL por TCP (`--protocol=TCP -h 127.0.0.1`) si la ruta de socket no corresponde. `mysqldump --routines --events --triggers` requiere permisos para leer y restaurar esos objetos; la cuenta root del contenedor normalmente los tiene. Si se usa otra cuenta, verifica sus privilegios antes del respaldo.

Ejemplo en Bash desde `/opt/comgraf-beta/lite`; sustituye las dos rutas de ejemplo después de comprobar en privado el `APP_DATA_DIR` de `.runtime/low-resource/.env`. El directorio de destino debe estar en otro disco protegido y tener espacio suficiente:

```bash
set -e
set -o pipefail
BACKUP=/ruta/protegida/comgraf-$(date +%Y%m%d-%H%M%S)
APP_DATA_DIR=/ruta/local/configurada/para/la/aplicacion
mkdir -m 700 "$BACKUP"
scripts/low-resource-compose.sh stop app
if ! scripts/low-resource-compose.sh exec -T db sh -ec 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump --protocol=TCP -h 127.0.0.1 -uroot --single-transaction --quick --no-tablespaces --routines --events --triggers --hex-blob --databases "$MYSQL_DATABASE"' | gzip -1 > "$BACKUP/mysql.sql.gz.part"; then
  echo 'Falló mysqldump; no continúes la actualización' >&2
  exit 1
fi
gzip -t "$BACKUP/mysql.sql.gz.part" && test -s "$BACKUP/mysql.sql.gz.part" && gzip -dc "$BACKUP/mysql.sql.gz.part" | awk '/^CREATE TABLE/{found=1} END{exit !found}'
mv "$BACKUP/mysql.sql.gz.part" "$BACKUP/mysql.sql.gz"
tar -C "$APP_DATA_DIR" -czf "$BACKUP/files.tar.gz.part" uploads mail-secrets
tar -tzf "$BACKUP/files.tar.gz.part" >/dev/null && mv "$BACKUP/files.tar.gz.part" "$BACKUP/files.tar.gz"
cp .runtime/low-resource/.env "$BACKUP/runtime.env"
chmod 600 "$BACKUP/runtime.env"
scripts/low-resource-compose.sh start app
```

Si cualquier verificación falla, **no continúes la actualización** ni marques el respaldo como completo; revisa el error y vuelve a iniciar la aplicación anterior cuando sea seguro. `pipefail` permite detectar un fallo de `mysqldump` aunque `gzip` termine bien. La mera existencia del archivo no valida el respaldo. SQL y archivos se verifican por separado. No almacenes SQL ni secretos en un medio sin control de acceso.

Prueba periódicamente una **restauración en otro host o proyecto aislado**: crea volúmenes y credenciales de prueba independientes, importa `mysql.sql.gz` allí mediante `gzip -dc ... | mysql --protocol=TCP ...`, restaura `files.tar.gz` en sus rutas de prueba y comprueba clientes, solicitudes, adjuntos, revisión Alembic y arranque de la misma imagen. El dump usa `--databases`, por lo que contiene el nombre de la base original: **no** lo importes en el servidor real para un ensayo. Volver a una imagen anterior **no revierte migraciones**; antes de cualquier reversión comprueba compatibilidad del esquema y conserva un respaldo conjunto de SQL y archivos previo a la actualización.

## Diagnóstico seguro

`scripts/diagnose-deployment.sh` muestra rama, commit, existencia de cambios locales, estado de contenedores, salud, IDs de imagen y versión servida. No imprime contenido de `.env`, cookies ni tokens. Si Docker o el entorno low-resource faltan, informa la ausencia y termina sin modificar nada. Para recursos usa `docker stats --no-stream` o `scripts/low-resource-compose.sh stats --no-stream`; para errores usa logs acotados y revisa que no contengan datos sensibles antes de compartirlos. Se pueden compartir rama, commit, IDs de imagen, salud, versión y errores redactados. No compartas `docker compose config` completo, dumps, `.env`, cabeceras de sesión ni trazas con datos de clientes.
