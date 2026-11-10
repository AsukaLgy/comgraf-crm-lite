# Revisión de mantenimiento · 2026-11-09

Punto de partida: rama `feat/order-print-preview`, commit `52d70aaf22d894cccd9ecd548caff7488642fcb9`, árbol limpio. Todas las pruebas de escritura se ejecutaron con `TEST_MYSQL_DATABASE=comgraf_delete_test`; no se utilizó la base real. Las cifras siguientes corresponden a **este entorno de desarrollo**, no al Core 2 Duo ni al NAS.

## Hallazgos por impacto

1. **Consultas repetidas:** `/api/orders` consultaba productos, cantidades entregadas y estado por cada OP. Cinco órdenes ficticias producían 34 `SELECT` en una petición autenticada con rol Producción. Se agruparon productos y cantidades para la página; ahora son 11 `SELECT` con las mismas filas, cantidades y estados. No se añadió índice ni caché: el problema medido era el número de viajes a MySQL.
2. **Carga inicial:** `App.jsx` importaba el detalle y la impresión antes de necesitarlos. La división por ruta reduce el JavaScript inicial sin retirar QR ni vista previa. La carga total de `dist` permanece casi igual; se optimiza lo que descarga y analiza la pantalla inicial.
3. **Refetch demasiado amplio:** editar título o etapa invalidaba todas las consultas, incluso usuarios, roles y versión. `caseCache.js` delimita las proyecciones del expediente, órdenes, agenda, contadores cuando corresponde y vista de cliente. El smoke verifica que la lista de usuarios no se vuelve a pedir tras esas dos operaciones.
4. **Mantenimiento y documentación:** `format:check` ya fallaba en 11 archivos. Ruff no estaba instalado localmente; al instalar la versión declarada detectó 11 imports/variables sin uso, retirados sin cambiar reglas. README y guías de actualizaciones históricas podían confundirse con los pasos del servidor actual. [Operación](OPERACION.md) es la guía principal; los documentos anteriores enlazan a ella.
5. **Despliegue:** el wrapper no admitía separar ajustes locales de `compose.low-resource.yaml`, y no existía un diagnóstico de versión/imagen. El override es opcional y explícito; el diagnóstico solo lee estado y oculta contenido de configuración.

## Dependencias

Se revisaron `frontend/package.json`, `package-lock.json`, `backend/requirements.txt`, `requirements-dev.txt`, `requirements.lock.txt`, Dockerfile, Compose, plugins y scripts. No se eliminó ninguna biblioteca: React, React Query, Router, QRCode, ZXing y Lucide tienen imports de aplicación; Vite, ESLint, Prettier y Playwright intervienen en build, lint o pruebas. FastAPI, SQLAlchemy, Alembic, PyMySQL, pwdlib, python-multipart, pydantic-settings, cryptography y tzdata sustentan la API o compatibilidad. `httpx` aparece en `scripts/verify_restart.py` y `pytest` en las pruebas que también ejecuta el perfil ligero dentro de la imagen. Los recursos de marca y scripts de la interfaz se sirven localmente; no se encontró una carga CDN en `frontend/src`, `index.html` o `public`. No se cambió ningún lockfile ni versión masivamente. `npm ci --ignore-scripts --offline` en un directorio temporal instaló las 310 dependencias del lock sin vulnerabilidades reportadas por npm. Un entorno virtual Python 3.14 nuevo instaló los 38 paquetes de `requirements.lock.txt` con `uv pip sync`; `uv pip check` confirmó que son compatibles.

## Comparación reproducible

| Métrica en este entorno | Antes | Después |
| --- | ---: | ---: |
| `SELECT` para cinco OP en `/api/orders?view=production&page_size=100`, rol Producción | 34 | 11 |
| JavaScript inicial (`dist/assets/index-*.js`, bytes) | 444 905 | 365 401 |
| JavaScript inicial comprimido según Vite | 138.94 kB | 113.64 kB |
| Directorio `frontend/dist` completo (`du -sb`, bytes) | 1 130 393 | 1 131 760 |
| Hallazgos Ruff en `app tests ../scripts` | 11 | 0 |

El total de `dist` creció 1 367 bytes por los fragmentos y su infraestructura; no se midió latencia de red, CPU del NAS ni tiempo de usuario. `npm run format:check` mantiene los mismos 11 avisos previos: una reformateación masiva añadiría un cambio de revisión difícil de separar de las mejoras funcionales.

## Verificación posterior

- Backend: `pytest -q` **79 aprobadas**, una advertencia deprecada de Starlette/TestClient; `alembic check` sin operaciones nuevas.
- Frontend: `npm run build` y `npm run lint` correctos. Vite advierte que el Node local es 18.19.1; el Dockerfile de construcción usa Node 24.
- Flujos ficticios: `print-smoke.mjs`, `v150-ui-smoke.mjs`, `ui-smoke.mjs` y `client-delete-smoke.mjs` correctos. Se inspeccionó la captura de detalle en escritorio y los PDF continúan mostrando la OP seleccionada.
- `sh -n` y pruebas con Docker simulado verificaron wrapper base, override desde entorno y `.env`, fallo por override ausente, y diagnóstico de IDs distintos sin revelar un secreto ficticio. El diagnóstico real en este entorno informó con claridad que Docker no está instalado.

## Límites y siguientes revisiones

No se construyó ni desplegó una imagen Docker ni se comprobó el servidor físico: Docker no está disponible aquí y esta tarea prohíbe el despliegue. Las consultas de calendario e indicadores aún recorren casos y OP; requieren una medición aislada y pruebas de equivalencia antes de reescribirse. La paginación de esas vistas también debe evaluarse con datos representativos. El formato heredado en 11 archivos queda identificado, sin mezclar una reformateación amplia con esta revisión. No se modificaron MySQL real, NAS, Caddy, Tailscale ni datos de clientes.
