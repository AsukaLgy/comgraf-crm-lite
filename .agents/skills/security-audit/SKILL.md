---
name: security-audit
description: "Audita autenticación, autorización, endpoints, validación de entrada, credenciales y protección de datos en COMGRAF CRM."
---

# Security Audit

## Cuándo usarla
- Para revisar sesiones, roles, permisos, API, carga/descarga de archivos o manejo de datos personales y financieros.
- Para analizar cambios que amplían la superficie de acceso o alteran la validación de solicitudes.

## Contexto de proyecto
Lee `AGENTS.md`, `docs/ARQUITECTURA.md` y `docs/OPERACION.md`; verifica los controles en el middleware, routers, servicios y configuración activos.

## Procedimiento
1. Dibuja el flujo de identidad desde login/cookie hasta `current_user`, permisos y mutaciones.
2. Para cada endpoint sensible verifica autenticación, autorización por objeto/propietario, validación, respuesta y efecto en la base.
3. Revisa protección de solicitudes de mismo origen, cookies, gestión de sesiones, errores y exposición de información.
4. En archivos adjuntos verifica tamaño, formato, firma/contenido, ubicación, acceso autenticado y borrado.
5. Revisa manejo de variables y secretos en configuración, scripts y contenedores sin leer ni copiar valores.
6. Reporta hallazgos reproducibles con amenaza, precondición, impacto y mitigación proporcional.

## Herramientas permitidas
Lectura estática, `rg`, configuración de seguridad, análisis de dependencias y pruebas no invasivas con cuentas y datos sintéticos en entorno aislado.

## Restricciones
No abras ni imprimas `.env`, tokens, cookies, hashes o claves; no uses credenciales reales. No envíes solicitudes que creen, borren o alteren datos en servicios operativos. No realices escaneos de red o pruebas de explotación fuera de un entorno autorizado y aislado.

## Validación
Demuestra el control o defecto con evidencia de código y, solo si está autorizado y aislado, una prueba negativa que confirme el rechazo esperado. Clasifica separado: vulnerabilidad confirmada, riesgo de diseño y recomendación preventiva.
