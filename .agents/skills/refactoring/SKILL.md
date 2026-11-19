---
name: refactoring
description: "Simplifica y reorganiza módulos de COMGRAF CRM preservando comportamiento, contratos, datos e interfaces existentes."
---

# Refactoring

## Cuándo usarla
- Cuando un módulo grande dificulta cambios frecuentes o tiene responsabilidades que ya se pueden delimitar.
- Cuando se identifica duplicación real que puede compartirse sin alterar reglas de negocio.

## Contexto de proyecto
Lee `AGENTS.md`, `docs/ARQUITECTURA.md` y la documentación del flujo afectado; confirma el grafo de dependencias desde el código actual.

## Procedimiento
1. Identifica el comportamiento observable y sus consumidores antes de mover funciones o componentes.
2. Define una unidad de cambio pequeña: una responsabilidad, un flujo y un conjunto concreto de archivos.
3. Mantén contratos HTTP, formato de datos, nombres de rutas y semántica transaccional salvo que el usuario solicite cambiarlos.
4. Extrae primero funciones puras o límites con dependencias claras; evita capas nuevas si solo trasladan llamadas.
5. Mantén frontend y backend como autoridades de sus responsabilidades: el backend valida reglas; la UI puede ofrecer validación de ayuda.
6. Comprueba las referencias de campos heredados y migraciones antes de proponer su eliminación.

## Herramientas permitidas
Git de solo lectura para diagnóstico, búsqueda de referencias, edición puntual de los archivos autorizados y pruebas focalizadas del comportamiento extraído.

## Restricciones
No conviertas el sistema en microservicios, no añadas dependencias por conveniencia y no elimines campos, tablas, endpoints o compatibilidad histórica basándote solo en tamaño o antigüedad. No cambies reglas mientras reorganizas código.

## Validación
Compara entradas/salidas antes y después con casos representativos, ejecuta las pruebas específicas del flujo en entorno seguro y revisa el diff para detectar cambios de contrato o limpieza accidental. Documenta qué responsabilidades quedaron en cada módulo.
