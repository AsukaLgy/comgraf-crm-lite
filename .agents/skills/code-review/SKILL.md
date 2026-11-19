---
name: code-review
description: "Revisa cambios y commits de COMGRAF CRM buscando defectos, errores lógicos, redundancias y regresiones. Úsala para revisar un diff, commit o conjunto de archivos antes de integrarlo."
---

# Code Review

## Cuándo usarla
- Para revisar un commit, pull request, diff o cambios locales.
- Para investigar si una modificación rompe contratos, permisos o reglas de negocio existentes.

## Contexto de proyecto
Lee `AGENTS.md` y `docs/ARQUITECTURA.md`; consulta la documentación del flujo afectado y confírmala en el código actual.

## Procedimiento
1. Ejecuta `git status --short --branch` y delimita exactamente el diff que se solicitó revisar.
2. Usa `git diff --check`, `git diff` o `git show` sin cambiar el índice ni el árbol de trabajo.
3. Para cada cambio, rastrea sus llamadores, validaciones, permisos, transacción y consumidor de frontend.
4. Contrasta contratos API, estados de expediente/OP, finanzas, contacto e impresión según el área afectada.
5. Reporta primero hallazgos concretos con severidad, evidencia y consecuencia; después dudas y sugerencias no bloqueantes.

## Herramientas permitidas
Git en modo lectura (`status`, `diff`, `show`, `log`), búsqueda (`rg`), lectura de código y pruebas focalizadas no destructivas cuando el entorno está aislado.

## Restricciones
No edites archivos, no stages cambios y no asumas que las modificaciones sin commit pertenecen al revisor. No ejecutes la suite backend antes de inspeccionar `backend/tests/conftest.py` y comprobar el aislamiento de la base; ese fixture elimina datos de tablas de la base configurada.

## Validación de la revisión
Verifica cada hallazgo contra el diff y una referencia de uso real. Informa si una conclusión es bug, riesgo, regresión potencial o preferencia. Si no se ejecutaron pruebas, indica cuáles serían necesarias y por qué no se ejecutaron.
