# COMGRAF CRM

CRM de la imprenta para solicitudes, clientes, cotizaciones, órdenes de producción, entregas y cobros. La interfaz React y la API FastAPI comparten origen; SQLAlchemy y Alembic gestionan MySQL. La interfaz funciona sin CDN ni servicios externos obligatorios.

**Guía principal:** [Operación, desarrollo, actualización y recuperación](docs/OPERACION.md). Para cambios de negocio y mapa de módulos, consulta [Mantenimiento](docs/MANTENIMIENTO.md) y [Arquitectura](docs/ARQUITECTURA.md). La [revisión de mantenimiento](docs/REVISION_MANTENIMIENTO.md) registra métricas y pruebas comparables. Las instrucciones de versiones anteriores se conservan como historial y no sustituyen la guía principal.

## Estructura

| Ruta | Contenido |
| --- | --- |
| `frontend/src/` | React, navegación, formularios, detalle, QR y plantilla de impresión. |
| `frontend/e2e/` | Pruebas de navegador y recorridos con datos ficticios. |
| `backend/app/` | API, autorización, reglas de negocio, consultas, modelos y configuración. |
| `backend/migrations/` | Migraciones Alembic, aplicadas incrementalmente. |
| `backend/tests/` | Pruebas de integración contra MySQL aislado (`*_test`). |
| `scripts/` | Preparación, arranque, respaldo, wrapper Compose y diagnóstico. |
| `docker/` | Configuración de imágenes y proxy. |
| `docs/` | Guías actuales, decisiones técnicas y registros de migraciones anteriores. |

La versión de producto está en `frontend/package.json`, `frontend/src/api.js` y `backend/app/version.py`. El contrato HTTP es independiente. El Dockerfile recibe `BUILD_COMMIT` y `BUILD_DATE` durante la construcción; `/api/version` expone ambos, además de la versión y el contrato. No uses el campo legado `build` para identificar el código en ejecución.

## Desarrollo rápido

Usa Python 3.14, Node 24 y una base MySQL 8.4 separada de cualquier instalación real. No hay credenciales predeterminadas. Copia `.env.example` a `.env` únicamente para desarrollo y completa sus valores sin incorporarlos a Git.

```sh
python3.14 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.lock.txt
.venv/bin/python -m pip install -r backend/requirements-dev.txt
npm --prefix frontend ci --ignore-scripts
cd backend
../.venv/bin/python -m alembic upgrade head
APP_HOST=127.0.0.1 APP_WORKERS=1 ../.venv/bin/python -m app.start
```

En otra terminal, desde la raíz, `npm --prefix frontend run dev`. Vite reenvía `/api` a la API local. Para crear la primera cuenta en una base vacía, detén la API y ejecuta desde `backend/`: `../.venv/bin/python -m app.cli create-admin`. El comando pide la contraseña sin mostrarla.

Para pruebas, establece `TEST_MYSQL_DATABASE` con una base terminada en `_test`:

```sh
cd backend
TEST_MYSQL_DATABASE=comgraf_delete_test ../.venv/bin/python -m pytest -q
../.venv/bin/python -m ruff check app tests ../scripts
cd ../frontend
npm run lint
npm run build
```

Las pruebas de navegador completas requieren una instancia aislada y credenciales ficticias; los smoke tests `frontend/e2e/*.mjs` usan respuestas simuladas. La guía principal explica instalación, migraciones, pruebas y restauración con más detalle.

## Servidor de pocos recursos

La instalación beta usa `/opt/comgraf-beta/lite`, `compose.low-resource.yaml` y `scripts/low-resource-compose.sh`. **No** uses `docker compose` sin el wrapper para esa instalación. El override local opcional se selecciona mediante `LOW_RESOURCE_OVERRIDE_FILE`; si no se configura, el comportamiento es el anterior. Consulta [Operación](docs/OPERACION.md#actualizar-optcomgraf-betalite) antes de actualizar: exige revisar cambios locales, respaldar SQL y adjuntos, comparar commits, construir la imagen, recrear solo `app` y verificar la versión efectivamente servida.

Diagnóstico de solo lectura desde cualquier directorio:

```sh
/opt/comgraf-beta/lite/scripts/diagnose-deployment.sh
```

No hagas `reset --hard`, no borres volúmenes y no supongas que un checkout actualizado implica que el contenedor ejecuta la nueva imagen. Las mediciones de desarrollo no demuestran rendimiento ni compatibilidad física del Core 2 Duo.

## Documentos históricos

[Perfil LAN ligero](docs/LAN_LIGERO.md), [resultados de laboratorio](docs/LAN_LIGERO_RESULTADOS.md), [retirada de mensajería](docs/RETIRADA_MENSAJERIA.md), [actualización de canales beta](docs/ACTUALIZACION_CANALES_BETA.md), [versión 1.5.0](docs/RESULTADOS_1_5.md), [eliminación e impresión](docs/ELIMINACION_E_IMPRESION.md). Se conservan para entender migraciones y decisiones anteriores; usa [Operación](docs/OPERACION.md) para los pasos actuales de despliegue y recuperación.
