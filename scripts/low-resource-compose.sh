#!/bin/sh
# Wrapper with a dedicated Compose project, env file and preflight. Never invokes compose.yaml.
set -eu
REPO=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENV_FILE=${LOW_RESOURCE_ENV_FILE:-"$REPO/.runtime/low-resource/.env"}
cd "$REPO"
OVERRIDE_FILE=${LOW_RESOURCE_OVERRIDE_FILE:-}
if [ -z "$OVERRIDE_FILE" ] && [ -r "$ENV_FILE" ]; then
  OVERRIDE_FILE=$(awk -F= '$1 == "LOW_RESOURCE_OVERRIDE_FILE" {sub(/^[^=]*=/, ""); print; exit}' "$ENV_FILE")
fi
if [ -n "$OVERRIDE_FILE" ] && [ ! -f "$OVERRIDE_FILE" ]; then
  printf 'No existe el archivo override configurado: %s\n' "$OVERRIDE_FILE" >&2
  exit 1
fi
case "${1:-}" in
  up|start|restart|run|create)
    python3 scripts/verify-low-resource-storage.py --env-file "$ENV_FILE"
    ;;
esac
if [ -n "$OVERRIDE_FILE" ]; then
  exec docker compose --project-name comgraf-lan-light \
    -f compose.low-resource.yaml -f "$OVERRIDE_FILE" --env-file "$ENV_FILE" "$@"
fi
exec docker compose --project-name comgraf-lan-light \
  -f compose.low-resource.yaml --env-file "$ENV_FILE" "$@"
