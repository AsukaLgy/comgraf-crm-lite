---
name: regression-testing
description: "Diseña y ejecuta pruebas de regresión para los flujos de COMGRAF CRM: solicitudes, varias OP, estados, clientes, cobranza y documentos impresos."
---

# Regression Testing

## Cuándo usarla
- Para definir cobertura antes de tocar reglas de negocio.
- Para verificar cambios funcionales de solicitudes, clientes/contactos, producción, entregas, pagos o impresión.
- Para reproducir un defecto con un escenario repetible.

## Contexto de proyecto
Lee `AGENTS.md` y `docs/ARQUITECTURA.md`; inspecciona los tests y fixtures existentes antes de proponer casos nuevos.

## Procedimiento
1. Traduce el comportamiento solicitado en precondiciones, acciones, resultados esperados y roles involucrados.
2. Prioriza pruebas unitarias para lógica aislada y de integración para transacciones, permisos y MySQL.
3. Para producción cubre una solicitud con uno y varios productos/OP; verifica cliente, contacto, comentario y datos de impresión por OP.
4. Incluye transiciones válidas e inválidas, solicitudes cerradas/completadas, entregas parciales, anticipos/saldos, reintentos idempotentes y visibilidad por rol cuando sean pertinentes.
5. Ejecuta solo la selección mínima que cubre el cambio y registra comando, entorno y resultado real.

## Herramientas permitidas
Pytest y utilidades de prueba del proyecto, tests unitarios de Node y checks frontend documentados. Para pruebas de navegador, Playwright solo cuando el escenario lo requiera y exista un entorno de prueba aislado.

## Restricciones
Antes de cualquier prueba backend, inspecciona `backend/tests/conftest.py`, configuración MySQL y destino de `UPLOAD_DIR`. El fixture limpia tablas; el sufijo `_test` por sí solo no prueba que una base sea desechable. No ejecutes pruebas contra la base del servicio, volúmenes operativos ni datos reales. Si no puedes confirmar aislamiento, detén la ejecución y explica la condición necesaria.

## Validación
Comprueba que el test falla ante el defecto que pretende detectar y pasa con el comportamiento correcto, sin cambiar datos ajenos. Verifica resultados HTTP, estado persistido y efectos secundarios relevantes; para impresión, comprueba el archivo/render con datos sintéticos y el formato de OP establecido.
