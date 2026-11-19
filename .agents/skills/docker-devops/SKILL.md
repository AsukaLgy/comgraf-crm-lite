---
name: docker-devops
description: "Revisa y mantiene el despliegue LAN de COMGRAF en Debian y Docker: imágenes, Compose, permisos, backups, consumo y recuperación."
---

# Docker DevOps

## Cuándo usarla
- Para auditar `Dockerfile`, `compose*.yaml`, wrappers, arranque y healthchecks.
- Para investigar consumo de recursos, permisos de volúmenes, backups o recuperación ante fallos en el equipo LAN.

## Contexto de proyecto
Lee `AGENTS.md`, `docs/OPERACION.md`, `docs/LAN_LIGERO.md` y los scripts que el procedimiento invoque. Confirma el perfil activo antes de recomendar comandos.

## Procedimiento
1. Inspecciona la imagen, usuario del contenedor, puertos, volúmenes, healthcheck, límites y variables sin revelar valores secretos.
2. Sigue el wrapper de Compose documentado; confirma qué archivo, perfil y proyecto selecciona.
3. Evalúa persistencia de MySQL y uploads, permisos, copias SQL/archivos y compatibilidad de migraciones.
4. Diagnostica primero con estado, salud, métricas puntuales y logs acotados; diferencia imagen construida, contenedor ejecutado y versión servida.
5. Para recuperación, especifica el respaldo requerido, el entorno aislado de restauración y las verificaciones posteriores.
6. Prioriza cambios pequeños compatibles con Debian y el hardware limitado; mide antes de aumentar recursos o añadir servicios.

## Herramientas permitidas
Lectura de Dockerfile/Compose/scripts y comandos de inspección de solo lectura como `docker compose ps`, `docker stats --no-stream`, `docker inspect` con salida redactada y logs acotados.

## Restricciones
No ejecutes `down -v`, prune, borrado de volúmenes, migraciones destructivas, restauraciones sobre producción ni despliegues. No recrees ni detengas contenedores operativos sin autorización explícita. No imprimas `.env` ni la salida completa de `docker compose config`.

## Validación
Valida sintaxis de Compose sin divulgar valores, confirma mounts y permisos en entorno de prueba, y ensaya restauraciones solo en un proyecto/volumen aislado. Para cambios de imagen comprueba por separado build, salud, versión servida y persistencia; nunca infieras disponibilidad por el mero hecho de que un contenedor esté iniciado.
