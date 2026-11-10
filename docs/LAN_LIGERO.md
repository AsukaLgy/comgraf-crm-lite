# Comgraf LAN ligero — perfil experimental
> **Guía vigente:** [Operación](OPERACION.md) contiene el procedimiento actual de actualización, respaldo y diagnóstico para `/opt/comgraf-beta/lite`. Este documento conserva el contexto de la intervención que describe.


Este perfil existe en la rama `experiment/lan-low-resource` y usa el proyecto Compose `comgraf-lan-light`. Mantiene la aplicación completa; crea una base, adjuntos, secretos, registros, certificados y respaldos separados. El Compose normal `compose.yaml`, su base y sus puertos no se modifica al usar los comandos de esta guía. No se copian `.env`, certificados privados, la cuenta Yahoo ni datos reales. El correo queda sin configurar.

El commit base de la rama es `b3969fd0453f9d496986703277a20dbdea1caf1f`. Las mediciones hechas en la computadora de desarrollo y sus límites están en [LAN_LIGERO_RESULTADOS.md](LAN_LIGERO_RESULTADOS.md); no equivalen a una prueba en el NAS.

## Compatibilidad del CPU y selección de MySQL

El Core 2 Duo E6320 es x86-64, pero pertenece a la generación anterior a x86-64-v2. El contenedor MySQL actual del proyecto (`mysql:8.4.11`) usa Oracle Linux 9; [esa plataforma exige x86-64-v2](https://docs.oracle.com/en/operating-systems/oracle-linux/9/install/install-SystemRequirements.html) y puede abortar en el E6320 antes de iniciar MySQL. `platform: linux/amd64` solo selecciona arquitectura y no añade SSE4.1/SSE4.2/POPCNT que el procesador no tenga. La etiqueta `8.4.11` y su variante `oraclelinux9` se pueden comprobar en [Docker Official Images](https://hub.docker.com/_/mysql?tab=tags).

El perfil propone mantener MySQL 8.4 LTS en 64 bits usando el paquete upstream de MySQL APT `8.4.13-1debian12` dentro de Debian 12. Se descargó y examinó el ELF de `mysqld`: declara `x86-64-baseline`; no se cambió a SQLite o MariaDB ni se bajó a una rama antigua. La guía oficial de [MySQL APT admite Debian Bookworm y el canal 8.4 LTS](https://dev.mysql.com/doc/refman/8.4/en/linux-installation-apt-repo.html). La clave `RPM-GPG-KEY-mysql-2025`, con huella `BCA43417C3B485DD128EC6D4B7B3B788A8D3785C`, renueva la vigencia de la clave de firma aceptada por el repositorio hasta octubre de 2027; APT verifica la firma, y el build falla si la huella no coincide. La versión está fijada en el Dockerfile para que la imagen sea reproducible; revisa y actualiza esa versión explícitamente con los parches de seguridad de MySQL.

El Dockerfile de Comgraf fija `-march=x86-64 -mtune=generic` y `RUSTFLAGS=-C target-cpu=x86-64` para las dependencias Python que deban compilar desde fuente. El build instalado en esta máquina recibió wheels manylinux x86-64 para dependencias nativas como `cryptography`, `cffi`, `greenlet` y `pydantic-core`. La etiqueta manylinux expresa compatibilidad de biblioteca/plataforma Linux según [PEP 600](https://peps.python.org/pep-0600/), pero no basta para certificar cada instrucción de CPU. La inspección ELF encontró variantes AVX/AVX2/AES en dos wheels; no declaró una ISA requerida, pero su selección dinámica todavía debe validarse en E6320. Se extrajo el ELF de `mysqld` y Python del contenedor y `readelf -n` informa `x86-64-baseline` para ambos; `go version -m` del Caddy fijado informa `GOAMD64=v1`, nivel baseline según [Go](https://go.dev/wiki/MinimumRequirements#amd64). React se sirve como archivos JavaScript/CSS y no lleva el compilador de Node a producción. Estas propiedades reducen el riesgo, pero no sustituyen el arranque y una prueba funcional de **estas mismas imágenes** en el E6320.

La máquina de desarrollo detectada al preparar esta rama es Zorin OS 18.1/Ubuntu 24.04, kernel 6.17, Core i3-7020U con SSE4.1/SSE4.2/POPCNT/AVX2, 15 GiB RAM y Docker en `/var/lib/docker`. No es el servidor destino y los números de rendimiento locales no certifican el Core 2.

## Inventario de solo lectura

El script no instala paquetes, edita OpenMediaVault, modifica UFW ni reinicia servicios. Ejecútalo en el NAS y conserva la salida completa (no muestra `.env`):

```sh
chmod +x scripts/diagnose-lan-host.sh
./scripts/diagnose-lan-host.sh | tee ~/comgraf-lan-host-inventory.txt
```

Confirma especialmente arquitectura, flags y nivel de glibc, `MemAvailable`, swap, sistema de archivos del futuro disco, dónde guarda Docker sus capas (`DockerRootDir`), puertos ocupados y servicios SMB/MySQL. El diagnóstico local de esta rama mostró que la computadora de desarrollo tiene una CPU más nueva; la salida de ese equipo no debe presentarse como la del NAS.

Antes de probar, instala y monta el futuro disco local de MySQL desde el procedimiento habitual de OpenMediaVault. **No uses SMB/CIFS/NFS para `/var/lib/mysql`**. La comprobación de montaje falla cerrada si el directorio configurado apunta al sistema raíz o a un sistema remoto. No se formatea ni particiona ningún disco.

## Preparación aislada

Requisitos: Debian/OMV de 64 bits, Docker Engine y Compose v2 compatibles con `mem_limit`/`cpus`, `findmnt`, salida de red solo para descargar imágenes y paquetes durante el build. Construye artefactos en una máquina de preparación y transfiérelos si el NAS no tiene Internet. El primer build de MySQL instala el paquete firmado de Oracle desde el repositorio APT; no activa correo.

Ejemplo en el NAS, con el disco de base montado en `/srv/comgraf-mysql` y un directorio local para datos de aplicación en `/srv/comgraf-lan`:

```sh
python3 scripts/prepare-low-resource.py \
  --mysql-data-dir /srv/comgraf-mysql/lan-light \
  --app-data-dir /srv/comgraf-lan
```

El directorio MySQL debe estar vacío. El preparador genera contraseñas aleatorias nuevas en `.runtime/low-resource/.env`, modo 0600, y nunca las imprime. El archivo se guarda fuera de Git. Si ya existe, no lo sobrescribe. La ruta de aplicación contiene `uploads`, `mail-secrets`, `logs`, `backups` y el estado CA local de Caddy. La cuenta que prepara/ejecuta Compose debe poder escribir ahí; el contenedor web se ejecuta con su UID/GID, no como root.

Para prueba desechable en una computadora de desarrollo (nunca para instalar datos reales), las únicas rutas aceptadas con disco raíz son bajo `.runtime/lan-light-test-data`:

```sh
python3 scripts/prepare-low-resource.py \
  --mysql-data-dir .runtime/lan-light-test-data/mysql \
  --app-data-dir .runtime/lan-light-test-data/app --test-mode
```

El perfil escucha inicialmente solo en `127.0.0.1:18443` y `127.0.0.1:18080`. Para una prueba LAN, edita el `.env` aislado y cambia `HTTPS_BIND` por la IP LAN fija/reservada del NAS y `HTTPS_HOST` por esa misma IP. No uses `0.0.0.0` salvo que quieras publicar el servicio en todas las interfaces; limita el acceso a la LAN con la política de red existente. No abras puertos del router. Caddy emite una CA privada local. Exporta únicamente su certificado público con `docker cp comgraf-lan-light-https_proxy-1:/data/caddy/pki/authorities/local/root.crt ./comgraf-lan-light-root.crt`, transfiérelo al teléfono por un medio local y confía en él desde los ajustes de certificados de Android. **No copies `root.key`**. El navegador debe mostrar HTTPS confiable para permitir cámara. No reutilices el certificado privado de producción.

Para construir en una máquina de preparación (sin `.env`, sin acceso a la base ni a secretos del NAS):

```sh
docker build -t comgraf-app:lan-low-resource -f Dockerfile .
docker build -t comgraf-mysql:8.4-debian12-baseline docker/mysql-low-resource
docker pull caddy:2.11.7-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f
docker tag caddy:2.11.7-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f comgraf-caddy:2.11.7-alpine
docker save -o comgraf-lan-light-images.tar \
  comgraf-app:lan-low-resource comgraf-mysql:8.4-debian12-baseline \
  comgraf-caddy:2.11.7-alpine
sha256sum comgraf-lan-light-images.tar
```

Transfiere el archivo por LAN/USB al NAS y compara su SHA-256; luego ejecuta `docker load -i comgraf-lan-light-images.tar`. Este archivo contiene imágenes, no datos del CRM, pero mantenlo privado hasta revisar su contenido. `comgraf-caddy` es una etiqueta local para que Compose no intente contactar el registro al arrancar (`pull_policy: never`). Las bases Debian/Node/Python y Caddy están fijadas a los digest inspeccionados en esta rama; actualiza deliberadamente sus digest junto con MySQL cuando prepares un parche de seguridad.

Para esta rama ya se prepararon un bundle local de Git y el tar de imágenes en `.runtime/low-resource/`: `comgraf-lan-light.bundle`, `comgraf-lan-light-images.tar` y `SHA256SUMS`. Copia **solo esos tres archivos** por LAN/USB; no copies `.runtime/low-resource/.env`, `lan-secrets`, datos de prueba ni certificados. En la carpeta temporal del NAS, verifica y prepara el checkout así:

```sh
sha256sum -c SHA256SUMS
git clone --branch experiment/lan-low-resource ./comgraf-lan-light.bundle comgraf-crm-lan-light
docker load -i comgraf-lan-light-images.tar
cd comgraf-crm-lan-light
```

Luego genera credenciales nuevas para el NAS con `scripts/prepare-low-resource.py` y los montajes locales elegidos. Las imágenes son `linux/amd64`; el bundle conserva el commit `18e2d6dc4e0af897fc1cfdf9c94e672eded4d5a4` y el tar contiene únicamente las imágenes app, MySQL experimental y Caddy. Los checksums protegen la transferencia, no certifican el hardware.

Construcción en el mismo host NAS, si tiene red de salida:

```sh
scripts/low-resource-compose.sh config --quiet
scripts/low-resource-compose.sh build
docker pull caddy:2.11.7-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f
docker tag caddy:2.11.7-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f comgraf-caddy:2.11.7-alpine
scripts/low-resource-compose.sh up -d --no-build
scripts/low-resource-compose.sh ps
```

Antes de `up`, `start`, `restart`, `run` o `create`, el wrapper valida que existan los directorios y que la base esté en almacenamiento local; solo la ruta `--test-mode` permite una prueba en el disco raíz. `stop`, `logs`, `ps` y `down` siguen disponibles aunque el disco de base esté desconectado para poder detener y diagnosticar el perfil. La aplicación ejecuta las migraciones Alembic. La mensajería ya no forma parte del servicio; ninguna variable antigua la reactiva. Para actualizar una instalación existente, sigue [RETIRADA_MENSAJERIA.md](RETIRADA_MENSAJERIA.md). Crea el administrador experimental de forma interactiva:

```sh
scripts/low-resource-compose.sh exec app python -m app.cli create-admin
```

Abrir `https://<HTTPS_HOST>:18443`. Para confirmar que Docker usa la ubicación que elegiste, compara `docker info --format '{{.DockerRootDir}}'` con el bind mount de la base: `scripts/low-resource-compose.sh config` y `docker inspect` del contenedor `comgraf-lan-light-db-1`. Los límites de almacenamiento de MySQL se aplican al `MYSQL_DATA_DIR` local, aunque el directorio raíz de Docker siga en el disco del sistema.

Parar/reiniciar/actualizar solo este perfil:

```sh
scripts/low-resource-compose.sh stop
scripts/low-resource-compose.sh start
scripts/low-resource-compose.sh build
scripts/low-resource-compose.sh up -d --no-build
scripts/low-resource-compose.sh logs --tail=100
```

No uses `down -v`; no es necesario para actualizar. Al transferir artefactos, registra el SHA-256 de las imágenes y vuelve a comprobar que Compose no intente descargar otra variante en el NAS. El build de Node/React se ejecuta fuera del NAS; el NAS ejecuta el frontend compilado. No fuerces arquitectura con emulación.

## Límites de recursos iniciales

Son límites de partida, no un resultado de benchmark del NAS:

| Servicio | Límite de memoria | CPU | Ajuste |
|---|---:|---:|---|
| MySQL 8.4 | 1280 MiB | 0.80 CPU | `innodb_buffer_pool_size=512M`, `max_connections=24`, buffers por conexión moderados |
| FastAPI + trabajador | 768 MiB | 0.80 CPU | 1 proceso Uvicorn, 8 hilos, concurrencia 16, pool SQLAlchemy 5 + 1 overflow por proceso |
| Caddy | 128 MiB | 0.10 CPU | TLS local y proxy |

El máximo reservado por límites suma 2176 MiB y 1.70 CPU; deja margen para Debian, OpenMediaVault, SMB, kernel y caché de archivos dentro de 4 GiB/2 núcleos. El pool máximo aproximado es 12 conexiones (web y trabajador) más margen de administración/health; MySQL acepta hasta 24. Si se añaden procesos, recalcula la suma antes de subir `max_connections`. El pool usa `pool_pre_ping`, espera finita y overflow pequeño; no se desactiva la durabilidad: `innodb_flush_log_at_trx_commit=1` queda explícito.

Los logs Python rotan por archivo a 5 MiB con cuatro respaldos, en `APP_DATA_DIR/logs/app`. MySQL escribe error y slow-query logs bajo `APP_DATA_DIR/logs/mysql`, con umbral inicial 0.8 s. Docker rota stdout/stderr y los guarda bajo su `DockerRootDir`; confirma y gestiona por separado ese disco. Los informes del benchmark son JSON y se escriben en la ruta indicada. Ningún límite debe aumentarse sin observar swap, OOM, latencia y disco.

## Pruebas reproducibles

Todas las pruebas automatizadas usan `comgraf_lan_test` y limpian tablas; verifica la base antes de ejecutar. Los datos tienen prefijo DEMO. Nunca apuntes `MYSQL_DATABASE` a la instancia operativa. El Compose de prueba lleva base/volúmenes/puertos distintos y no recibe credenciales Yahoo.

Después de arrancar un perfil local aislado:

```sh
scripts/low-resource-compose.sh exec -e COOKIE_SECURE=false app python -m pytest tests -q -p no:cacheprovider
scripts/low-resource-compose.sh exec app python -m tests.low_resource_seed
```

El archivo con cinco cuentas temporales queda en `APP_DATA_DIR/test-uploads/low-resource-test-users.json` (modo 0600). Ejecuta contra el HTTPS de prueba; el benchmark espera a que `/api/health` confirme que la API está lista. Para la CA interna local, proporciona la CA mediante `--ca-cert`:

```sh
python3 scripts/low-resource-benchmark.py smoke \
  --base-url https://localhost:18443 \
  --credentials /srv/comgraf-lan/test-uploads/low-resource-test-users.json \
  --ca-cert /tmp/comgraf-lan-light-root.crt
python3 scripts/low-resource-benchmark.py idle --duration 120 --sample-interval 5 \
  --mysql-data-dir /srv/comgraf-mysql/lan-light
python3 scripts/low-resource-benchmark.py load \
  --base-url https://localhost:18443 \
  --credentials /srv/comgraf-lan/test-uploads/low-resource-test-users.json \
  --ca-cert /tmp/comgraf-lan-light-root.crt \
  --users 5 --duration 600 --sample-interval 5 \
  --mysql-data-dir /srv/comgraf-mysql/lan-light \
  --output /srv/comgraf-lan/logs/low-resource-load.json
```

`smoke` recorre login, creación de cliente/solicitud, asignación, nota, orden CAI, avance Aprobación→Impresión, calendario, adjunto y descarga. `load` ejecuta consultas de bandejas, cliente, expediente y calendario como cinco usuarios distintos, con pausas aleatorias de 0.25–0.65 s entre pantallas y 2–5 s entre recorridos. Registra p50/p95/máximo, HTTP/timeouts, máximos por contenedor, conexiones/consultas lentas MySQL, E/S y espera del dispositivo que contiene los datos de MySQL, RAM/swap del host y contadores OOM/fallos mayores. `/proc/diskstats` mide el dispositivo completo, no solo el contenedor; en un disco compartido los resultados incluyen otros servicios. Ejecuta la prueba breve primero. Detén con Ctrl+C si la máquina empieza a intercambiar memoria, aparecen OOM, el disco se satura o servicios preexistentes se degradan.

Este benchmark no incluye escrituras concurrentes artificiales; la prueba funcional es secuencial. No envía correo. Los tiempos de una computadora moderna son una línea de base del código/contendedores con límites, no una simulación de la velocidad por ciclo de un E6320. El arranque exacto en hardware Core 2 y una prueba de cinco usuarios en OMV siguen siendo necesarias.

## Respaldo y restauración

Al terminar la prueba, respalda con el CRM detenido para incluir una pareja coherente de DB/adjuntos. Ejemplo de respaldo manual (conserva el archivo de configuración con permisos 0600 y cifra el medio fuera del NAS):

```sh
scripts/low-resource-compose.sh stop app
mkdir -p /ruta/de/respaldo/comgraf-lan-light
scripts/low-resource-compose.sh exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump --protocol=socket -uroot --single-transaction --routines --events --triggers --databases "$MYSQL_DATABASE"' > /ruta/de/respaldo/comgraf-lan-light/mysql.sql
tar -C /srv/comgraf-lan -czf /ruta/de/respaldo/comgraf-lan-light/files.tar.gz uploads mail-secrets
cp .runtime/low-resource/.env /ruta/de/respaldo/comgraf-lan-light/runtime.env
chmod 600 /ruta/de/respaldo/comgraf-lan-light/runtime.env
scripts/low-resource-compose.sh start app
```

Guarda el respaldo fuera del NAS; `runtime.env`, `mail-secrets/fernet.key` y los respaldos SQL contienen credenciales o claves. El respaldo necesita la DB, adjuntos y clave Fernet histórica para conservar los datos anteriores. Preserva esa carpeta aunque esta versión no use correo. Para restaurar en un NAS de prueba con directorios MySQL vacíos:

```sh
# Copia runtime.env a .runtime/low-resource/.env (modo 0600); ajusta solo
# MYSQL_DATA_DIR, APP_DATA_DIR, APP_UID y APP_GID para el equipo nuevo.
tar -C /srv/comgraf-lan -xzf /ruta/de/respaldo/comgraf-lan-light/files.tar.gz
scripts/low-resource-compose.sh up -d db --no-build
scripts/low-resource-compose.sh exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --protocol=socket --socket=/run/mysqld/mysql.sock -uroot -e "DROP DATABASE IF EXISTS \`$MYSQL_DATABASE\`;"'
scripts/low-resource-compose.sh exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --protocol=socket --socket=/run/mysqld/mysql.sock -uroot' < /ruta/de/respaldo/comgraf-lan-light/mysql.sql
scripts/low-resource-compose.sh up -d --no-build
```

Extrae los archivos solo en una carpeta de aplicación vacía y restaura con el mismo usuario de sistema o corrige propietario a `APP_UID:APP_GID`. La primera orden inicia MySQL y crea sus cuentas desde `runtime.env`; luego se repone el esquema y finalmente arranca la aplicación. Caddy crea una nueva CA local; vuelve a confiar en su certificado raíz en los teléfonos. No importes este dump sobre la base operativa.

## Validación final pendiente en el NAS

1. Ejecuta `diagnose-lan-host.sh`; confirma `x86_64`, 64 bits, flags/loader, versión Debian, RAM/swap y montaje del disco de MySQL.
2. Comprueba que el E6320 arranca la imagen MySQL baseline exacta y que `SELECT VERSION()` responde; después ejecuta smoke, reposo y 5 usuarios/10 minutos.
3. Revisa `/api/health`, `docker stats`, `/proc/vmstat` (`oom_kill`, `pswpin`, `pswpout`), `logs/mysql/slow.log`, `docker inspect` de mounts y espacio libre de ambos discos.
4. Confirma latencia, lectura/escritura de archivos de prueba y cámara HTTPS desde Android con su CA instalada.

Hasta completar esos pasos, el estado es **compatible, pendiente de pruebas en hardware objetivo**. Si el NAS corre 32-bit, carece de una versión Docker soportada, o el `mysqld` exacto falla en E6320, detén este perfil y conserva la base; no pruebes emulación como despliegue normal. Si MySQL deba convivir con SMB y OMV en esos recursos, no se puede prometer experiencia adecuada para cinco usuarios sin mediciones del servidor físico. Un disco local independiente para MySQL mejora la contención de E/S; si la RAM/CPU medida queda corta, mantén el NAS como almacenamiento y ejecuta Comgraf/MySQL en otro equipo de bajo consumo.
