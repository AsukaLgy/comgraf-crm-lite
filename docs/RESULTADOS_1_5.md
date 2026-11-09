# Comgraf 1.5.0: implementación y verificación local

## Cambios

- La selección administrativa de etapa usa una operación propia con comprobación de rol en el servidor. Bloquea OP anuladas, bloqueadas o con entregas registradas. Mantiene la versión y clave de reintento de la solicitud y registra un evento con OP, etapas, autor, hora y origen `admin_manual`. No crea escaneos, entregas ni cobros.
- La eliminación de solicitudes reutiliza la vista previa, transacción y limpieza de archivos existente. El diálogo exige `comgraf`; el servidor valida la palabra y el rol. Se puede abrir desde el detalle y desde el historial del cliente.
- Las tablas operativas ocultan el saldo. Las bandejas de Entregas y cobros lo muestran solo con permiso financiero. Pool general y el historial del cliente muestran la fecha de creación en `America/Tegucigalpa`.
- Los textos visibles de “Partida(s)” pasan a “Producto(s)”. Los códigos internos y datos históricos permanecen. El filtro de etapas envía los mismos códigos con etiquetas del catálogo español.
- El título se edita en línea con versión y control de acceso del expediente. El escáner dispone de una operación acotada al QR válido, sin abrir la navegación general.
- La impresión aislada ofrece Carta vertical con la OP en la mitad superior y media carta personalizada. La misma plantilla se usa para vista previa e impresión. El documento espera imágenes, QR y fuentes.
- La interfaz y las fuentes de configuración indican 1.5.0. La imagen recibe commit y fecha de construcción como argumentos; `/api/version` los expone por separado del contrato HTTP.

## Pruebas ejecutadas

- `TEST_MYSQL_DATABASE=comgraf_delete_test ../.venv/bin/python -m pytest -q`: **78 aprobadas**. Solo se usó la base de pruebas.
- `npm run build`: **correcto**. Vite advirtió que el Node local es 18.19.1 y recomienda 20.19+ o 22.12+; la imagen de construcción usa Node 24.
- `npm run lint`: **correcto**, con aviso de configuración de versión React del plugin ESLint.
- `node e2e/v150-ui-smoke.mjs`: **correcto** en 1366 × 768 y 390 × 844. Verificó Pool sin saldo, hora local de creación, selector administrativo sin diálogo de motivo y edición del título.
- `node e2e/client-delete-smoke.mjs`: **correcto** en escritorio y móvil. Verificó el acceso secundario, diálogo y cancelación desde historial, además de las protecciones de eliminación de clientes.
- `node e2e/ui-smoke.mjs`: **correcto** en escritorio y móvil. Verificó alta rápida, conservación de borrador y contexto de navegación.
- `node e2e/print-smoke.mjs`: **correcto**. Generó PDF Carta de **612 × 792 pt, 1 página**; media carta de **612 × 396 pt, 1 página**; y ejemplo largo Carta de **3 páginas**. Verificó texto completo, logo, ausencia de navegación/botones y QR `CGOP1:19e39a12-26bc-4315-9eef-06e1c7af1946`, decodificado de la imagen de la OP seleccionada. `pdftotext -bbox` situó la última línea de la orden normal a 321.4 pt y la última de cada página larga a 339.6, 354.3 y 315.1 pt, todas dentro de la mitad superior (396 pt).
- `git diff --check`: **correcto**.
- `TestClient` con variables de construcción apuntando al checkout local: `/api/version` devolvió `product_version: 1.5.0`, `contract_version: 5`, commit `abc86471b28a5bb0ff680147d313a929f3914b68` y fecha UTC inyectada. Este checkout aún contiene cambios sin commit; la comprobación de la imagen final corresponde al commit que se apruebe.
- `TestClient` sin inyectar metadatos y con el `.env` local anterior: devolvió `product_version: 1.5.0`, `commit: unknown` y `build_date: unknown`. El identificador legado `build` aún refleja `local-1.4.0`; no se usa como versión del producto.

## Evidencia ficticia

- Capturas: `.runtime/v150-proof/`, `.runtime/print-proof/`, `.runtime/client-delete-proof/`.
- PDF: `.runtime/print-proof/orden-carta.pdf`, `orden-media-carta.pdf`, `orden-larga-carta.pdf`.

## Publicación y límites

Consulta [ACTUALIZACION_1_5.md](ACTUALIZACION_1_5.md) para reconstruir y recrear solo `app` con el wrapper low-resource después de revisar y confirmar el commit. No se ha desplegado, hecho push ni probado una impresora física. En desarrollo, sin metadatos inyectados, el commit de `/api/version` es `unknown`; la prueba del commit real corresponde a la imagen que se construya desde el commit aprobado. No se modificaron NAS, Caddy, Tailscale ni configuraciones de impresora.
