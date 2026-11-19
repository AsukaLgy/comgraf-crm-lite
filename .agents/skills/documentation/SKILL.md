---
name: documentation
description: "Mantiene documentación y diagramas de COMGRAF CRM alineados con el código real, incluyendo instalación, operación, actualización y manuales humanos."
---

# Documentation

## Cuándo usarla
- Para actualizar README, arquitectura, procedimientos de actualización, backups, resolución de fallos o guías de usuarios.
- Para crear diagramas que expliquen flujos confirmados de la aplicación.

## Contexto de proyecto
Lee `AGENTS.md`, `README.md`, `docs/ARQUITECTURA.md` y `docs/OPERACION.md`; valida cada instrucción contra código, Compose y scripts vigentes.

## Procedimiento
1. Identifica a quién va dirigida la documentación y la tarea que debe completar.
2. Localiza la fuente de verdad: configuración real, endpoint, script, modelo o flujo de UI.
3. Corrige la sección existente más cercana; evita crear una guía duplicada.
4. Usa comandos copiable y explícitos, marca requisitos previos y distingue instalación normal de perfil low-resource.
5. Para diagramas Mermaid, representa solo relaciones verificadas e indica cuándo un paso es manual.
6. Revisa enlaces, rutas, versiones y ejemplos afectados por el cambio.

## Herramientas permitidas
Lectura y edición de Markdown, Mermaid y ejemplos documentales; búsquedas para confirmar nombres y referencias.

## Restricciones
No inventes puertos, variables, credenciales, comportamientos ni pasos de recuperación. No publiques secretos, datos de clientes o salidas completas de configuración que puedan contener valores sensibles. No alteres código ni configuración operativa desde esta skill.

## Validación
Comprueba que rutas y enlaces existan, que comandos coincidan con scripts actuales y que el flujo pueda seguirse sin contexto oral del autor. Separa claramente procedimientos verificados de supuestos o dependencias del entorno.
