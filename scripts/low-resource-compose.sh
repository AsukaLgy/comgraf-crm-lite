#!/bin/sh
# Wrapper with a dedicated Compose project, env file and preflight. Never invokes compose.yaml.
set -eu
REPO=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENV_FILE=${LOW_RESOURCE_ENV_FILE:-"$REPO/.runtime/low-resource/.env"}
cd "$REPO"
case "${1:-}" in
  up|start|restart|run|create)
    python3 scripts/verify-low-resource-storage.py --env-file "$ENV_FILE"
    ;;
esac
exec docker compose --project-name comgraf-lan-light \
  -f compose.low-resource.yaml --env-file "$ENV_FILE" "$@"
