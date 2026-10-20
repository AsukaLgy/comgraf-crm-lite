# Resultados del perfil LAN ligero

Mediciones realizadas el 20 de octubre de 2026 en una instalación experimental aislada basada en `b3969fd0453f9d496986703277a20dbdea1caf1f`. La rama es `experiment/lan-low-resource`; no se publicó ni se fusionó.

## Equipo donde se midió

La computadora de prueba fue una Zorin OS 18.1 (Ubuntu 24.04), kernel 6.17.0-35, Intel Core i3-7020U a 2.30 GHz, 2 núcleos/4 hilos, 15 GiB RAM, sin swap y SSD ext4 de 121 GiB (`/dev/sda5`, raíz, 44 GiB libres). Docker Engine 29.9 y Compose 5.6 almacenan capas en `/var/lib/docker`. El CPU ofrece x86-64-v2, AVX y AVX2; por tanto, no es el Core 2 Duo E6320 del NAS.

Había contenedores operativos de Comgraf y Frappe en el mismo host. No se detuvieron ni modificaron. Los datos de la prueba se guardaron en `.runtime/lan-light-test-data`, MySQL usó una base `_test`, se generaron usuarios ficticios y el correo Yahoo permaneció deshabilitado. Los puertos experimentales fueron `127.0.0.1:18443` y `127.0.0.1:18080`.

## Artefactos y compatibilidad observada

- `mysql:8.4.11` de Docker Official Images usa Oracle Linux 9, cuya plataforma exige x86-64-v2; eso excede la CPU Core 2. `platform: linux/amd64` solo expresa arquitectura y no añade SSE4.1/SSE4.2/POPCNT. Se mantuvo MySQL 8.4 LTS con el paquete APT firmado `8.4.13-1debian12` dentro de Debian 12.
- El MySQL experimental arrancó en esta máquina y respondió `8.4.13`, `max_connections=24`, `innodb_buffer_pool_size=536870912` y `innodb_flush_log_at_trx_commit=1`. `readelf -n` reportó `x86-64-baseline` para `mysqld` y el binario de Python 3.14. Caddy 2.11.7 fue inspeccionado con `GOAMD64=v1`, el baseline de Go.
- Se auditaron los 13 `.so` instalados en el contenedor Python. No declaran una propiedad ELF `x86 ISA needed`, pero `objdump` encuentra variantes AVX/AVX2 en `pydantic_core` y AVX/AES en `cryptography`. Esas bibliotecas suelen seleccionar rutinas por capacidades del CPU, pero la inspección estática no demuestra la ruta que ejecutarán en E6320. Hace falta iniciar e importar las dependencias en el Core 2 antes de declarar compatibilidad probada. Los wheels `manylinux` indican una política de compatibilidad Linux, no certifican por sí solos una ISA concreta.
- Las capas Debian/Node/Python están fijadas a digests; `CFLAGS=-march=x86-64 -mtune=generic` y `RUSTFLAGS=-C target-cpu=x86-64` evitan compilar dependencias desde fuente con el CPU moderno del builder. React se compila durante la preparación y el NAS solo sirve los archivos estáticos.

La selección conserva el canal MySQL 8.4 LTS mantenido para Debian, usando el repositorio MySQL APT oficial. La evidencia en la CPU objetivo sigue pendiente; ver [LAN_LIGERO.md](LAN_LIGERO.md) para el procedimiento.

## Pruebas

| Prueba | Resultado |
|---|---|
| Build de aplicación, frontend y MySQL | Correcto; Compose valida la configuración |
| MySQL real aislado | `8.4.13`, servicio saludable; durabilidad InnoDB en `1` |
| Smoke HTTPS antes y después del ajuste de contadores | 17 acciones HTTP, sin errores: sesión, cliente, solicitud, asignación, nota, CAI, cambio a Impresión, calendario, adjunto, descarga, búsqueda, bandeja y contadores |
| Reposo | 120 s, 17 muestras; 0 consultas lentas nuevas, 0 OOM y 0 swap-in/out |
| Carga antes | 5 cuentas distintas, 600 s, 83 muestras, 2,494 acciones HTTP, 0 errores |
| Carga después | 5 cuentas distintas, 600 s, 83 muestras, 2,600 acciones HTTP, 0 errores |
| Suite backend final | 51 pasaron; 1 aviso de deprecación de `TestClient`/Starlette |

En reposo, los máximos observados por contenedor fueron aproximadamente 85 MiB FastAPI, 434 MiB MySQL y 13 MiB Caddy. Bajo carga, los máximos independientes fueron 113 MiB, 449 MiB y 15 MiB. El host tuvo al menos 6.19 GiB disponibles y no registró OOM; como el host no tiene swap, esta corrida no valida el comportamiento con swap habilitado. CPU máxima reportada durante carga: 82.5% para FastAPI y 34.3% para MySQL, ambos dentro de sus cuotas de 0.8 CPU.

Latencia HTTP en las dos corridas de cinco usuarios, milisegundos:

| Recorrido | Antes p50 / p95 | Después p50 / p95 |
|---|---:|---:|
| Contadores (`/api/counts`) | 679 / 1,820 | 546 / 1,621 |
| Mis solicitudes | 108 / 431 | 96 / 502 |
| Búsqueda de cliente | 31 / 240 | 28 / 218 |
| Detalle de solicitud | 85 / 506 | 74 / 532 |
| Calendario | 137 / 738 | 78 / 529 |
| Inicio de sesión | 2,257 / 2,365¹ | 2,184 / 2,290¹ |

¹ Solo se hicieron cinco inicios de sesión por corrida; esos percentiles son orientativos. Las bases de datos se limpiaron entre corridas y tenían distinta cantidad de filas, así que la comparación de latencia no es una prueba pareada ni atribuye causalidad. La optimización comprobable de `/api/counts` redujo sus consultas SQL de 41 a 15; 27 consultas repetidas a `roles` bajaron a una por llamada. Una prueba de regresión afirma esta propiedad.

La actividad de `/proc/diskstats` se mide por dispositivo completo. En este host MySQL comparte `/dev/sda5` con el sistema, Docker y otros servicios; sus contadores de E/S no se pueden atribuir solo al CRM. Para valorar el disco dedicado del NAS, repite la prueba con la ruta montada en ese disco.

Los informes JSON completos se conservaron localmente bajo `.runtime/lan-light-test-data/app/logs/` (`smoke.json`, `idle.json`, `load.json`, `smoke-after.json` y `load-after.json`); `.runtime` está ignorado por Git. Contienen únicamente IDs y usuarios ficticios de prueba.

## Conclusión

**Compatible, pendiente de pruebas en hardware objetivo.** El perfil arranca en 64 bits y el binario MySQL verificado usa baseline x86-64. La aplicación completa pasó la suite y una carga de cinco usuarios en la computadora de desarrollo con límites de recursos. No se ejecutó nada en el NAS ni se probó el E6320; además, los wheels Python contienen rutas SIMD que requieren validar su selección de CPU. La carga midió consultas de lectura, no cinco usuarios editando simultáneamente.

Para el NAS, el perfil limita los tres servicios a 1.70 CPU y 2,176 MiB; una cuota no replica la velocidad del E6320, y deja menos de 0.3 CPU para Debian/OMV/SMB si los servicios alcanzaran sus topes a la vez. No prometemos cinco usuarios hasta repetir smoke, reposo y carga durante diez minutos en el servidor físico.
