# Observación ajena a la pausa de canales

En la versión previa, `CasePage` consulta el expediente con la clave React Query `['case', id, selectedProductionId]`, mientras `Composer` escribe el resultado de guardar una nota en `['case', String(record.id)]`. La clave no coincide, por lo que la nota guardada puede tardar hasta el siguiente refresco periódico en aparecer en la bitácora abierta. No se modificó ese flujo en esta actualización; requiere una corrección y prueba separadas.
