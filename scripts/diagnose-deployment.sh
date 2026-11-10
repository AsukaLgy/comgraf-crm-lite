#!/bin/sh
# Diagnóstico de solo lectura del perfil low-resource. Nunca muestra variables de entorno.
set -u
REPO=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
WRAPPER="$REPO/scripts/low-resource-compose.sh"
ENV_FILE=${LOW_RESOURCE_ENV_FILE:-"$REPO/.runtime/low-resource/.env"}
cd "$REPO" || exit 1

printf '== Código local ==\n'
if command -v git >/dev/null 2>&1; then
  branch=$(git branch --show-current 2>/dev/null || true)
  commit=$(git rev-parse HEAD 2>/dev/null || true)
  printf 'rama=%s\ncommit=%s\n' "${branch:-desconocida}" "${commit:-desconocido}"
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    printf 'cambios_locales=sí (contenido omitido)\n'
  else
    printf 'cambios_locales=no\n'
  fi
else
  commit=''
  printf 'Git no está disponible.\n'
fi

printf '\n== Docker Compose low-resource ==\n'
if ! command -v docker >/dev/null 2>&1; then
  printf 'Docker no está instalado o no está en PATH.\n'
  exit 0
fi
if ! docker compose version >/dev/null 2>&1; then
  printf 'Docker Compose v2 no está disponible.\n'
  exit 0
fi
if [ ! -r "$ENV_FILE" ]; then
  printf 'Falta el archivo local de configuración low-resource; se omite Compose.\n'
  exit 0
fi
if ! "$WRAPPER" ps; then
  printf 'No se pudo consultar el proyecto Compose. Comprueba permisos de Docker y configuración local.\n'
  exit 0
fi

configured_image=''
if command -v python3 >/dev/null 2>&1; then
  configured_image=$("$WRAPPER" config --format json 2>/dev/null | python3 -c \
    'import json,sys
try: print(json.load(sys.stdin)["services"]["app"]["image"])
except (KeyError, ValueError, TypeError): pass' 2>/dev/null)
fi
available_id=''
if [ -n "$configured_image" ]; then
  available_id=$(docker image inspect --format '{{.Id}}' "$configured_image" 2>/dev/null || true)
fi
container_id=$("$WRAPPER" ps -q app 2>/dev/null | head -n 1)
printf 'imagen_configurada=%s\nimagen_disponible=%s\n' "${configured_image:-desconocida}" "${available_id:-no disponible}"
if [ -z "$container_id" ]; then
  printf 'contenedor_app=no existe o está detenido\n'
  exit 0
fi
running_id=$(docker inspect --format '{{.Image}}' "$container_id" 2>/dev/null || true)
health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)
printf 'contenedor_app=%s\nimagen_ejecutada=%s\nsalud=%s\n' "$container_id" "${running_id:-desconocida}" "${health:-desconocida}"
if [ -n "$available_id" ] && [ -n "$running_id" ]; then
  if [ "$available_id" = "$running_id" ]; then
    printf 'comparación_imagen=la disponible coincide con la ejecutada\n'
  else
    printf 'comparación_imagen=la imagen disponible difiere de la ejecutada; revisa si falta recrear app\n'
  fi
fi

version=$("$WRAPPER" exec -T app python -c \
  'import urllib.request; print(urllib.request.urlopen("http://127.0.0.1:8000/api/version", timeout=4).read().decode())' 2>/dev/null || true)
if [ -z "$version" ]; then
  printf 'versión_servida=no disponible; revisa salud y logs\n'
  exit 0
fi
if command -v python3 >/dev/null 2>&1; then
  printf '%s' "$version" | python3 -c \
    'import json,sys
try:
 d=json.load(sys.stdin)
 for key in ("product_version","contract_version","commit","build_date"):
  print("%s=%s" % (key,d.get(key,"desconocido")))
except (ValueError,TypeError): print("versión_servida=respuesta inválida")'
else
  printf 'versión_servida=disponible; instala Python 3 para mostrar los campos de forma segura\n'
fi
served_commit=''
if command -v python3 >/dev/null 2>&1; then
  served_commit=$(printf '%s' "$version" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("commit", ""))
except (ValueError,TypeError): pass' 2>/dev/null || true)
fi
if [ -n "$commit" ] && [ -n "$served_commit" ] && [ "$served_commit" != unknown ] && [ "$commit" != "$served_commit" ]; then
  printf 'comparación_commit=el checkout local difiere del commit servido\n'
fi
