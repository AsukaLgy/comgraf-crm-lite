# Eliminación definitiva e impresión de OP

## Actualización

Ejecutar la migración Alembic `017_definitive_deletion` en el proceso habitual de actualización. Añade `deletion_audit` y `file_cleanup`. No requiere cambiar NAS, Caddy ni Tailscale. Las eliminaciones se ejecutan desde el CRM únicamente cuando un Administrador confirma el alcance.

La vista previa de eliminación es una instantánea de identificadores, versiones y cantidades. Si cambian, el servidor responde 409 y la interfaz solicita revisar la nueva vista. Los archivos administrados se encolan en la misma transacción y se limpian después del commit. Los fallos quedan pendientes y el ciclo de mantenimiento los reintenta.

## Impresión

El botón de la OP abre `/cases/{id}/print?production_id={id}` en una pestaña dedicada. La sesión se mantiene por cookie HTTP; la URL no contiene credenciales. La vista previa y el documento reutilizan `CasePrintSheet`. La regla `@page` pide media carta horizontal, 8.5 × 5.5 pulgadas (612 × 396 puntos). Se espera a fuentes, logo y QR antes de invocar `print()`.

En **Guardar como PDF**, seleccionar tamaño de papel **media carta**, orientación **horizontal**, márgenes **predeterminados** o **ninguno** según el navegador, y escala **100 %**. Algunos controladores ignoran `@page`; revisar la vista previa del controlador antes de imprimir físicamente. El código no puede imponer la configuración del papel de una impresora.

## Contexto de navegación

El detalle guarda la sección de origen en `from` y el retorno en `return`. Solo se aceptan rutas internas conocidas para volver. Un enlace directo sin contexto se marca determinísticamente como **Mis solicitudes**; no se deduce una procedencia real. Cambiar pestañas u OP conserva esos parámetros.
