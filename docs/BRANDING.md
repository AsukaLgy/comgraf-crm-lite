# Identidad visual local

El emblema limpio está en `frontend/public/branding/comgraf-logo.png` (PNG transparente, 640 × 611). La interfaz lo usa en inicio de sesión, navegación y escáner. `favicon-64.png` se generó al reducir esa misma imagen; a 64 píxeles sus trazos finos pierden detalle, pero conserva las formas y colores del emblema. Ambos archivos pasan sin transformación a `frontend/dist/branding` durante `npm run build` y a la imagen Docker mediante el Dockerfile existente.
