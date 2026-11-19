#!/bin/sh
# Wrapper with a dedicated Compose project, env file and preflight. Never invokes compose.yaml.
set -eu
REPO=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENV_FILE=${LOW_RESOURCE_ENV_FILE:-"$REPO/.runtime/low-resource/.env"}
cd "$REPO"
if [ -z "${APP_BUILD_TARGET:-}" ]; then
  TEST_MODE=$(awk -F= '$1 == "LOW_RESOURCE_TEST_MODE" {print $2; exit}' "$ENV_FILE" 2>/dev/null || true)
  if [ "$TEST_MODE" = '1' ]; then
    APP_BUILD_TARGET=test
  else
    APP_BUILD_TARGET=app
  fi
  export APP_BUILD_TARGET
fi
case "$APP_BUILD_TARGET" in
  app|test) ;;
  *) printf 'APP_BUILD_TARGET debe ser app o test.\n' >&2; exit 1 ;;
esac
if [ -z "${APP_IMAGE:-}" ]; then
  if [ "$APP_BUILD_TARGET" = 'test' ]; then
    APP_IMAGE=comgraf-app:lan-low-resource-test
  else
    APP_IMAGE=comgraf-app:lan-low-resource
  fi
  export APP_IMAGE
fi
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
