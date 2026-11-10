# Diagnóstico del alta de Talonario CAI

Revisión de partida: `c186f2a` (`feat/order-print-preview`). Todas las peticiones de diagnóstico se hicieron con clientes ficticios y MySQL `comgraf_test` 8.4.11 en el puerto local 3308. No se ejecutaron pruebas de escritura contra la instalación del puerto 8000.

## Falla reproducida

La interfaz nueva envía `POST /api/production-requests` con `product: "Talonario CAI"`, `quantity: "1"`, `games_per_pad: 25`, `payment_due_date: null`, `payment_terms: "Contado"`, `delivery_method: "Retiro en local"` y `unit_price: "0"`. El backend anterior, reproducido desde `13a4188` en un proceso aislado, respondió `500`, `Content-Type: text/plain; charset=utf-8`, cuerpo `Internal Server Error`. La misma petición contra el backend actual respondió `201`, `Content-Type: application/json` e identificadores válidos de solicitud y OP.

El traceback del proceso anterior mostró esta cadena:

```text
RequestValidationError: body.items.0.product
  Value error, Selecciona un producto del catálogo
  ctx.error = ValueError('Selecciona un producto del catálogo')
backend/app/main.py:99 validation_error -> JSONResponse({'detail': error.errors()})
TypeError: Object of type ValueError is not JSON serializable
```

La validación rechazó el producto antes de entrar al endpoint de creación. La consulta posterior halló **0 solicitudes** con el asunto de esa prueba. La respuesta no era JSON y `api.js` mostraba el texto genérico «No se pudo guardar. Reintenta.».

El proceso local encontrado en el puerto 8000 había arrancado antes de los commits `13a4188` y `c186f2a`. `/api/version` informaba contrato `5`, versión `1.5.0` y commit `unknown`: esos datos no distinguían un catálogo anterior. No se reinició ese proceso porque usa la configuración local ajena a la base aislada.

## Reparación y comprobación

- El catálogo vigente reconoce Talonario CAI; `CATALOG_REVISION = 2` se expone en `/api/version`. La interfaz comprueba esa revisión antes de enviar un producto CAI y explica cuándo hay que reiniciar el proceso local.
- El manejador de validación elimina `ctx`, `input` y `url` antes de construir JSON. Los errores internos tienen identificador de incidencia y traceback en el log; la respuesta no expone detalles internos.
- La fila nueva cambia a **1 talonario** al entrar en la familia de impresión. Una cantidad editada o cargada se conserva; el servidor sigue rechazando cero, fracciones y campos vacíos.
- La creación conserva la clave de idempotencia al reintentar los mismos datos. Una prueba interrumpió solo la respuesta después de que MySQL guardara: el reintento devolvió los mismos ID y una sola OP.
- La prueba de fallo sintético al proyectar la respuesta confirmó `500 JSON` con incidencia y rollback de solicitud, OP y clave de creación. Por tanto, una excepción en esa fase no deja registros huérfanos.

La matriz de navegador incluyó cliente existente y alta rápida, juegos 10/25/50, Contado/Crédito, Retiro en local/Entrega, fechas vacías/completas y precio cero/positivo. La OP se abrió e imprimió con QR. Los casos desde solicitud existente y cotización aceptada permanecen en las suites de integración y navegador.

## Aplicación local

Usa Node 24.11.1 (`frontend/.node-version`) para `npm ci --ignore-scripts`, pruebas y build. Antes de iniciar la aplicación con una base local, confirma `MYSQL_DATABASE` y el estado de Alembic; la base de pruebas utilizada estaba en `018_optional_payment_due` sin operaciones pendientes. Reinicia el proceso Python local después de actualizar el código: los módulos cargados por un proceso anterior no cambian al compilar el frontend. Comprueba después que `/api/version` incluya `catalog_revision: 2`. Este procedimiento no requiere una migración nueva ni un despliegue remoto.
