---
name: crm-architecture
description: "Analiza la arquitectura de COMGRAF CRM, las dependencias internas y los flujos entre React/Vite, FastAPI, SQLAlchemy y MySQL. Úsala para preguntas de estructura, límites de módulos, flujos de datos o diagramas."
---

# CRM Architecture

## Cuándo usarla
- Para explicar cómo está organizado el CRM y cómo se conectan sus capas.
- Para rastrear una función desde la pantalla React hasta el endpoint, servicio, consulta y modelo.
- Para valorar límites de módulos, acoplamiento o una propuesta arquitectónica antes de implementarla.

## Contexto de proyecto
Lee `AGENTS.md` y `docs/ARQUITECTURA.md` al inicio. Trátalos como documentación de referencia y verifica las afirmaciones en el código actual; no presupongas que describen la rama activa.

## Procedimiento
1. Registra rama, commit y estado de Git para distinguir el código actual de cambios locales.
2. Identifica entradas y composición: `frontend/src/main.jsx`, `App.jsx`, `frontend/src/api.js`, `backend/app/main.py` y routers.
3. Sigue la operación por la pantalla, cliente HTTP, router, schema, servicio, repositorio/modelo y migraciones que correspondan.
4. Busca consumidores, importadores y referencias antes de afirmar que un módulo o campo está aislado o sin uso.
5. Dibuja límites y dependencias con Mermaid cuando ayude a explicar el flujo. Etiqueta relaciones verificadas e inferidas por separado.
6. Contrasta los hallazgos con las reglas del expediente, múltiples OP, estados independientes, bitácora y permisos documentados.

## Herramientas permitidas
Lecturas de archivos, `rg`, `rg --files`, `git status`, `git log`, `git show`, `git diff` de solo lectura y herramientas de análisis estático que no escriban en el repositorio.

## Restricciones
Esta skill produce diagnóstico, no implementaciones. No deduzcas código muerto únicamente por no encontrar una referencia textual; revisa imports dinámicos, contratos, migraciones, serialización y datos históricos.

## Validación del análisis
Cada hallazgo debe incluir archivo y línea, el camino de dependencias que lo sustenta y el grado de certeza. Comprueba al menos una referencia de frontend y una de backend cuando la afirmación abarque ambas capas. Separa defectos demostrables de preferencias de organización.
