# Guía de mantenimiento de Comgraf

Para despliegue, respaldo y recuperación usa [Operación](OPERACION.md). Esta guía indica dónde cambiar cada comportamiento y qué invariantes debe conservar una intervención futura. Los nombres de campos históricos que ya no participan en el flujo activo están marcados en los modelos; no deben eliminarse sin migración y revisión de respaldos.

## Mapa del código

| Área | Punto de entrada | Responsabilidad |
| --- | --- | --- |
| Interfaz, rutas y sesión | `frontend/src/App.jsx` | Shell, navegación, lectura de sesión y permisos visibles. |
| Vocabulario de formularios | `frontend/src/domain.js` | Opciones compartidas de etapas, estados, prioridades, productos y condición de pago. Espejo para la interfaz; el servidor valida. |
| Acceso HTTP y formato | `frontend/src/api.js` | Fetch, errores, moneda, cantidades, fechas y conversiones de zona horaria. |
| Invalidación del expediente | `frontend/src/caseCache.js` | Refresca proyecciones afectadas sin recargar usuarios, roles ni versión al editar título o etapa. |
| Componentes comunes | `frontend/src/components.jsx` | Paneles, campos, diálogos, formularios y operaciones idempotentes. |
| Bandejas | `frontend/src/Inbox.jsx` | Bandeja general, filtros, vistas guardadas y búsqueda de expedientes. |
| Tabla compartida | `frontend/src/CaseTable.jsx` | Presentación de casos en bandejas e historial de cliente. |
| Alta y selección de cliente | `frontend/src/NewCase.jsx` | Nuevo caso, autocompletado y creación explícita de cliente/contacto. |
| Coordinación del expediente | `frontend/src/CasePage.jsx` | Carga, mutaciones y composición del expediente. Mantenerlo como coordinador y no concentrar presentación de todos los dominios aquí. |
| Atención y encabezado | `frontend/src/CaseAttention.jsx` | Abrir/cerrar atención, propietario e información de acción pendiente. |
| Actividad | `frontend/src/CaseActivity.jsx` | Bitácora, notas e historial de comunicaciones en solo lectura. Las notas no abren atención. |
| Etapas | `frontend/src/ProductionStages.jsx` | Barra de cinco etapas, clasificación histórica, programación, bloqueos y retrocesos. |
| Entrega y finanzas | `frontend/src/DeliveryFinance.jsx`, `CompleteDeliveryDialog.jsx` | Entrega completa por OP, cobro opcional en una transacción, saldos y permisos financieros. |
| Anulación comercial | `frontend/src/CasePage.jsx`, `DeliveryFinance.jsx`; `backend/app/services.py`, `repository.py` | Detener producción conservando entregas y movimientos; ajustar cargo final, resolver devoluciones o dejar revisión financiera pendiente. |
| Ficha imprimible | `frontend/src/CasePrintSheet.jsx`, `PrintDocument.jsx`, `OrderNavigation.jsx` | Lista y selector de OP, plantilla única y documento aislado con tamaños Carta/media carta. |
| Productos y conversión | `frontend/src/ProductForm.jsx`, `domain.js`; `backend/app/cai.py` | Productos, especificaciones, cotizaciones y ampliación del mismo caso a producción. |
| Historial de correo | `frontend/src/CaseActivity.jsx`; `backend/app/routers/history.py`, `repository.py` | Lectura de mensajes y adjuntos vinculados, bajo los permisos de la solicitud. |
| Notas | `frontend/src/Composer.jsx` | Borrador de Nota y plantillas; describe llamadas o visitas sin crear comunicaciones. |
| Endpoints | `backend/app/routers/` | HTTP, permisos de entrada, dependencias de sesión y traducción a servicios. |
| Respuesta del expediente | `backend/app/routers/common.py` | Proyección común posterior a una mutación; evita que un router importe otro. |
| Contratos | `backend/app/schemas.py` | Validación Pydantic. Rechaza campos extra y normaliza entradas. |
| Reglas de negocio | `backend/app/services.py` | Transiciones, permisos de dominio, idempotencia, concurrencia y bitácora. |
| Consultas y proyecciones | `backend/app/repository.py` | Visibilidad, saldos, estados derivados, serialización y bandejas. |
| Versión | `backend/app/version.py`, `Dockerfile` | Versión fija de producto y contrato; commit/fecha inyectados en la imagen. |
| Persistencia | `backend/app/models.py` | Tablas, claves, índices y campos heredados. Cambios de esquema requieren Alembic. |
| Roles y autenticación | `backend/app/security.py`, `backend/app/routers/auth.py` | Hash de contraseñas, sesión HTTP y autorización de servidor. |
| Esquema de base | `backend/migrations/versions/` | Cambios incrementales. Las revisiones aplicadas son inmutables. |

## Invariantes de operación

- Un caso conserva su ID durante toda su vida; producción se añade al caso, no crea otro expediente.
- Solo el alta desde Mis solicitudes asigna `Case.owner_id` al usuario autenticado. Producción, Bandeja general, Mi día y perfil de cliente crean sin asignar. Añadir una OP no cambia el propietario. El responsable operativo único es `Case.owner_id`. `Case.collection_owner_id` y `Production.owner_id` son columnas históricas y solo se conservan para compatibilidad y visibilidad heredada.
- `Production.stage` usa NEW, APPROVAL, PRINTING, WORKSHOP, READY. Las transiciones permitidas están expresadas como mapas de códigos, no por posiciones de una lista. `NULL` junto con `classification_required` significa etapa heredada ambigua por clasificar; no es una sexta etapa.
- `Delivery` calcula cantidades acumuladas; el estado Completa solo procede cuando cada producto está entregado. Entrega más cobro usa una sola transacción con bloqueo, versión e idempotencia. El importe se valida contra el saldo decimal de esa OP; un cobro requiere permiso `finance` incluso para quien puede entregar. Un saldo restante contado exige motivo; crédito vigente con vencimiento usa «Crédito acordado». `complete_resolved_production` se evalúa tras entrega, pago, ajuste, devolución y resolución de anulación. Usa `case_completion_blockers` por OP; no compensa saldos entre órdenes, resuelve recordatorios automáticos obsoletos y conserva tareas manuales abiertas. `finalize_case` registra una única transición. La mutación de un caso completado exige reactivación, salvo la operación de reapertura.
- Atención es solo `Abierto`/`Cerrado`; no usar el cierre como condición general de permiso o bloqueo. El predicado de acción inmediata es único en repositorio y servicio de recuperación.
- El propietario único es `Case.owner_id`. Columnas de responsable por área y datos de subetapa permanecen como históricos, sin reglas activas.
- El catálogo nuevo y los nueve tipos de documento fiscal viven en `backend/app/cai.py` y se reflejan en `frontend/src/domain.js`. `specs.fiscal_document_type` se exige en nuevas líneas CAI y no se asigna a registros históricos. Los nombres CAI anteriores se aceptan para lectura; la conversión a nueva OP los mapea a Talonario CAI sin reescribir snapshots ni cotizaciones. El formulario compartido no activa reglas fiscales para Talonarios y facturas. `games_per_pad` acepta enteros de 1 a 10 000; los presets son solo interfaz. Los valores de entrega nuevos son Retiro en local y Entrega; la validación acepta los dos valores históricos conocidos sin reescribir registros.
- `formatDate` presenta fechas de calendario sin zona UTC implícita; `formatDateTime` conserva horas de actividad y auditoría. Los instantes de entrega siguen almacenados como timestamp.
- Los campos `Production.authorized_at`, `approval_evidence`, `approved_snapshot` y `art_version` conservan datos del flujo anterior. No deben volver a imponer una autorización. `approved_snapshot` sigue siendo una fuente de impresión histórica si no existe `specs_snapshot`.
- Todas las operaciones financieras nuevas son HNL. Los registros USD históricos no se convierten ni se mezclan con HNL.
- `Case.version` y la clave idempotente protegen operaciones frente a doble envío y concurrencia. No quitar ambos controles de una mutación.
- La bitácora refleja el evento real. No inventar aprobaciones, envíos externos, pagos ni entregas.
- Una anulación conserva la obligación y movimientos anteriores; el ajuste de anulación cambia el cargo neto al total acordado. La devolución se registra como movimiento positivo solo cuando el usuario confirma que realmente la realizó.
- Detener producción requiere permiso `production`; una persona sin permisos `finance`/`adjust` puede anular y dejar revisión pendiente. Puede ver el estado neutral de revisión, pero no los importes ni acceder a la bandeja financiera.
- `cancellation_review_pending` impide presentar una obligación heredada o sin resolución como deuda exigible. Resolverla requiere permiso financiero y de ajuste; registrar devolución requiere permiso financiero e idempotencia.
- Las órdenes anuladas antes de la resolución comercial quedan para revisión por migración. No se les añade un ajuste ni se cambia el saldo automáticamente.
- La autorización del servidor es obligatoria aunque la interfaz oculte una acción. Las reglas críticas no se duplican solo como validación React.
- Al calcular saldos, no reinterpretar condiciones históricas de pago ni cambiar importes o vencimientos sin una acción auditada y una decisión comercial.
- Las tablas, borradores, mensajes, cuentas y adjuntos históricos de correo permanecen intactos. No se ejecuta ningún trabajador ni ruta de envío. El campo histórico `pending_message` no bloquea ya el cierre ni define acción de bandeja; las tareas, órdenes y saldos conservan sus reglas.

## Cómo cambiar una operación

1. Actualizar el esquema Pydantic y la regla del servicio. Añadir validación de relaciones y permisos en el backend.
2. Actualizar la ruta si cambia el contrato HTTP; conservar la gestión común de transacciones en `get_db`.
3. Actualizar el formulario, transformación de payload y estados de error correspondientes en frontend. Mantener entradas visibles al recibir error o conflicto.
4. Si cambia la persistencia, crear una migración nueva y reversible cuando sea seguro. No editar una migración aplicada, borrar la base, recrear IDs ni reescribir saldos históricos.
5. Añadir pruebas backend del contrato, permisos, historial y reintentos; ajustar o añadir un recorrido E2E para la interacción visible.
6. Ejecutar `alembic check`, `ruff check app tests`, pruebas backend, `npm run lint`, `npm run format:check`, compilación y Playwright contra una base cuyo nombre termine en `_test`.

## Convenciones de lectura

- Los encabezados `---- Dominio ----` agrupan funciones dentro de módulos. Si una sección crece, extraer un módulo del mismo dominio y mantener imports explícitos; evitar nuevos comodines.
- Mantener una función por transición de negocio y dejar en routers solo el contrato HTTP.
- Los nombres de las opciones visibles están centralizados en `frontend/src/domain.js`. Los esquemas Python son autoridad y deben actualizarse en el mismo cambio.
- Evitar lógica temporal basada en la zona del navegador. Usar la zona que entrega el servidor y las utilidades de `frontend/src/api.js`.
- `.env`, `.runtime`, adjuntos y `.vscode` son configuración/datos locales; no son parte de cambios de producto ni deben copiarse a Git.
- Antes de una actualización local, detener Python y ejecutar `scripts/update-local.ps1`; compila frontend y aplica migraciones sin limpiar MySQL ni adjuntos. Después reiniciar con `scripts/start-local.ps1`. `/api/version` diferencia producto, build y contrato HTTP.

## Consultas de bandeja

`repository.case_query()` es la fuente común de predicados para filas y contadores. Los filtros, orden, desempate por ID y paginación se aplican en MySQL; las bandejas usan una proyección ligera sin bitácoras, adjuntos o productos completos. Al agregar un filtro, actualizar tanto el query compartido como las pruebas de igualdad lista/contador. Verificar índices con las consultas reales antes de añadirlos; no ocultar un problema de rendimiento con caché.

## Estilo y herramientas

Desde la raíz: `npm.cmd --prefix frontend ci --ignore-scripts`, `lint`, `format:check`, `test:unit` y `build`. Usa Node 24.11.1 (`frontend/.node-version`); `package.json#engines` acepta la serie 24, coherente con Docker. Evita la instalación global de Node 18 para estas comprobaciones. `format` y `format:check` comparten alcance sobre código JS/JSX/MJS de `src`, `e2e` y `tests`; no mantienen listas manuales distintas. En backend: `..\.venv\Scripts\python.exe -m ruff check app tests`, Alembic y pytest. La configuración está en `frontend/eslint.config.js`, `.prettierrc.json` y `backend/pyproject.toml`; la lista de paquetes de desarrollo vive en `backend/requirements-dev.txt`.

`ProductForm.newItem` y `changeItemProduct` son la fuente de valores iniciales para Producción, OP dentro de una solicitud y cotizaciones. La marca de cantidad predeterminada solo vive en el editor y se retira en `cleanItems`; una cantidad introducida o cargada se conserva. Al entrar a la familia de talonarios desde una fila nueva se propone 1, y el servidor mantiene la validación de entero positivo. `backend/app/cai.py` define `CATALOG_REVISION`; `/api/version` la expone para detectar un servidor local antiguo antes de enviar productos nuevos. Reinicia el proceso Python después de actualizar el código; un proceso ya iniciado conserva módulos anteriores aunque la interfaz sirva archivos recién compilados.

`frontend/src/api.js` convierte errores JSON y respuestas no JSON en mensajes seguros y distingue resultados inciertos de rechazos. El middleware asigna `X-Comgraf-Incident` a errores internos, registra la excepción y el traceback sin leer el cuerpo de la petición, y oculta parámetros SQL en las excepciones. `NewProductionRequest` muestra el resultado de escritura antes de invalidar consultas; si falla esa actualización secundaria no informa falsamente que la OP no se guardó. Los reintentos idénticos usan la misma clave hasta que cambie el contenido.

La proyección `case_detail` incluye todas las OP y obtiene sus nombres de producto en una sola consulta por solicitud; `production_id` siempre debe pertenecer a esa solicitud. Sin identificador, selecciona la primera OP por orden estable y la interfaz fija ese ID en la URL manteniendo la pestaña. Las consultas del detalle y de impresión incluyen `production_id` en la clave de caché. Durante un cambio la impresión permanece deshabilitada hasta recibir la OP correcta; no usar datos anteriores como placeholder. Tras crear otra OP se invalida la vista de la solicitud y se abre su identificador. `CasePrintSheet` usa `specs_snapshot`, luego `approved_snapshot` y por último las líneas actuales solo para documentos antiguos. Para identidad antigua sin `client_snapshot` muestra explícitamente el cliente actual. No reescribir snapshots. Las especificaciones impresas se eligen por cada producto: CAI, formulario compartido genérico u otro; no decidir por la presencia de CAI en otra línea. Las hojas CSS `letter-order` y `half-order` comparten el mismo rectángulo imprimible de 8.5 × 5.5 pulgadas; el componente mide las filas al ancho de impresión y las distribuye en páginas explícitas que repiten identidad y QR. La salida es HTML imprimible para conservar texto seleccionable en PDF. El diálogo físico, sus márgenes no imprimibles y la opción de encabezados/pies dependen del navegador y controlador.

La composición visual común procede de la rama CAI de `52d70aa`: cabecera con logo, número de OP y solicitud, título y QR; bloque «Datos del cliente» en tres columnas; jerarquía de especificaciones y bordes. El bloque siempre muestra Empresa, Nombre del cliente, RTN, Teléfono y Correo, con «—» para valores vacíos. `service.convert` guarda `client_snapshot.client_name` desde `Client.name`, independientemente de empresa y contacto; conserva `person` para compatibilidad. `client_snapshot` es la fuente de reimpresión. Si una captura antigua carece de `client_name`, solo el nombre se toma de `record.client.name` con una nota de procedencia; `person` no lo sustituye. Si el snapshot omite otros campos, se muestra una nota de captura incompleta y no se mezclan datos actuales. Solo si falta por completo se usa un fallback identificado desde el perfil y el contacto vinculado a la solicitud. Si el perfil tiene varios teléfonos o correos sin selección inequívoca, el fallback deja el campo vacío. La paginación incluye el nombre resuelto y se recalcula ante cambios relevantes de contenido y tamaño, después de cargar fuentes e imágenes; `printReady` espera layout y QR antes de abrir el diálogo. Un bloque que supere por sí solo el área imprimible impide imprimir desde el botón y pide revisión, evitando un PDF recortado. Los detalles CAI muestran «Número de copias» para copias adicionales al original; se siguen omitiendo precios, juegos y hojas calculadas.

La reproducción del error de catálogo anterior, su respuesta HTTP y la prueba de rollback están documentadas en [Diagnóstico del alta de Talonario CAI](DIAGNOSTICO_ALTA_CAI.md).

## Verificación local

Desde `backend`:

```powershell
..\.venv\Scripts\python.exe -m alembic check
..\.venv\Scripts\python.exe -m pytest tests -q -p no:cacheprovider
```

Desde la raíz:

```powershell
npm.cmd --prefix frontend run build
```

Para E2E, seguir el procedimiento de `README.md`: sembrar credenciales aleatorias en `comgraf_test`, iniciar la app apuntando exclusivamente a esa base y ejecutar Playwright. La suite limpia datos de `_test`.

## Completar casos y seguimientos de recogida

`frontend/src/CaseAttention.jsx` presenta Completar/Reactivar y `frontend/src/CasePage.jsx` coordina las acciones y muestra `completion_blockers`. `backend/app/services.py` (`complete_resolved_production`, `finalize_case`, `complete_case`, `reactivate_case`, `schedule_pickup_followup`, `complete_task`) contiene las transacciones; `backend/app/repository.py` calcula bloqueos, ciclo y proyecciones de bandeja. No dupliques las reglas en React. La regularización histórica conserva su revisión previa y su ejecución explícita; el arranque no completa registros antiguos.

Las tareas de recogida usan `Task.category == PICKUP`; el vencimiento inicial es siete dias despues de entrar a READY. No crees una segunda tarea abierta al reintentar o volver a guardar READY. Una entrega completa resuelve unicamente tareas PICKUP. Al registrar contacto se puede marcar la tarea y, explicitamente, programar el siguiente control semanal.

`frontend/src/Composer.jsx` lee y guarda solo el borrador de Nota; no toca borradores históricos de otros canales. Las plantillas solo escriben texto editable; no registran pagos, entregas, aprobaciones ni seguimientos. Las referencias estructuradas de conversión se muestran en `CaseActivity.jsx`; conserva sus permisos y el destino dentro del expediente.

La migracion `007_case_completion_pickup` agrega ciclo de vida y tipo de tarea sin completar casos historicos. Aplicala con `alembic upgrade head`; no edites revisiones ya aplicadas. No reviertas automaticamente esta revision porque las tareas PICKUP y cambios de nulabilidad pueden contener actividad real.
