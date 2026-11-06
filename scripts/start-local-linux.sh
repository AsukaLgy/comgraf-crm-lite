#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="$ROOT/.venv/bin/python"
MYSQL="$ROOT/.runtime/tools/mysql-8.4.11-linux-glibc2.28-x86_64-minimal"
MYSQL_LIBS="$MYSQL/lib/private:$ROOT/.runtime/libaio/usr/lib/x86_64-linux-gnu"

check_database() {
  "$PYTHON" - "$ROOT/.env" <<'PY'
from dotenv import dotenv_values
import pymysql
import sys

config = dotenv_values(sys.argv[1])
try:
    connection = pymysql.connect(
        host='127.0.0.1', port=3307, user='comgraf',
        password=config['MYSQL_PASSWORD'], database='comgraf', connect_timeout=1,
    )
except pymysql.Error:
    sys.exit(1)
else:
    connection.close()
PY
}

if ! check_database; then
  echo 'Iniciando MySQL local…'
  LD_LIBRARY_PATH="$MYSQL_LIBS" "$MYSQL/bin/mysqld" --no-defaults \
    --basedir="$MYSQL" --datadir="$ROOT/.runtime/mysql-data" \
    --socket="$ROOT/.runtime/mysql.sock" --pid-file="$ROOT/.runtime/mysql.pid" \
    --log-error="$ROOT/.runtime/mysql.log" --bind-address=127.0.0.1 --port=3307 &
  mysql_pid=$!
  for _ in {1..30}; do
    if check_database; then break; fi
    if ! kill -0 "$mysql_pid" 2>/dev/null; then
      echo 'MySQL terminó. Revisa .runtime/mysql.log' >&2
      exit 1
    fi
    sleep 1
  done
  check_database || { echo 'MySQL no respondió en 30 segundos' >&2; exit 1; }
fi

echo 'Comgraf disponible en http://127.0.0.1:8000'
cd "$ROOT/backend"
APP_HOST=127.0.0.1 APP_WORKERS=1 "$PYTHON" -m app.start
