# Comgraf 1.5.0: actualización preparada
> **Guía vigente:** [Operación](OPERACION.md) contiene el procedimiento actual de actualización, respaldo y diagnóstico para `/opt/comgraf-beta/lite`. Este documento conserva el contexto de la intervención que describe.


Esta revisión no despliega la aplicación. Conserva `.runtime/low-resource/.env`, volúmenes de MySQL, adjuntos y configuración de Caddy/Tailscale. Después de revisar y crear el commit que se publicará, reconstruye **solo app** desde el checkout de ese commit:

```sh
git status --short
BUILD_COMMIT="$(git rev-parse HEAD)" BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)" scripts/low-resource-compose.sh build app
scripts/low-resource-compose.sh up -d --no-deps --force-recreate app
curl -sS http://127.0.0.1:8000/api/version
```

Si el proxy HTTPS es la única entrada disponible, consulta `/api/version` mediante su URL local HTTPS. Comprueba `product_version: 1.5.0`, `commit` igual al checkout construido y `build_date` de la nueva imagen. `contract_version` continúa siendo independiente (`5`). Cuando no se inyectan metadatos en desarrollo, `commit` y `build_date` indican `unknown`.
El campo antiguo `build` permanece por compatibilidad, pero puede contener un `BUILD_ID` local anterior; para identificar el código ejecutado utiliza `product_version` y `commit`. La versión del producto está fijada por el código y no depende del `PRODUCT_VERSION` que pueda conservar un `.env` antiguo.

La reconstrucción no elimina volúmenes ni recrea MySQL. `app.start` aplica migraciones pendientes de la aplicación al arrancar. No uses `down -v`.
Esta revisión no introduce una migración SQL nueva; usa las tablas de eventos, versiones, producción y eliminación ya existentes.

## Impresión

El modo predeterminado solicita papel Carta vertical de 8.5 × 11 pulgadas (612 × 792 pt). La orden usa la mitad superior; el área inferior se reserva con el margen de página y queda vacía. El modo Media carta solicita papel personalizado de 8.5 × 5.5 pulgadas (612 × 396 pt). Selecciona escala 100 % y desactiva encabezados y pies del navegador. La configuración física final depende del controlador de impresora; no se modifica desde la aplicación.
