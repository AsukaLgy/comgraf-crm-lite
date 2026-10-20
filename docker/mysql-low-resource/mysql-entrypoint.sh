#!/bin/sh
set -eu

DATADIR=${MYSQL_DATADIR:-/var/lib/mysql}
SOCKET=/run/mysqld/mysql.sock

case "${MYSQL_DATABASE:-}" in ''|*[!A-Za-z0-9_]*|[0-9]*) echo 'MYSQL_DATABASE inválida' >&2; exit 2 ;; esac
case "${MYSQL_USER:-}" in ''|*[!A-Za-z0-9_]*|[0-9]*) echo 'MYSQL_USER inválido' >&2; exit 2 ;; esac
case "${MYSQL_PASSWORD:-}" in *[!a-fA-F0-9]*|'') echo 'MYSQL_PASSWORD debe ser hexadecimal generado por prepare-low-resource.py' >&2; exit 2 ;; esac
case "${MYSQL_ROOT_PASSWORD:-}" in *[!a-fA-F0-9]*|'') echo 'MYSQL_ROOT_PASSWORD debe ser hexadecimal generado por prepare-low-resource.py' >&2; exit 2 ;; esac

mkdir -p "$DATADIR" /run/mysqld /var/log/mysql
chown mysql:mysql /run/mysqld /var/log/mysql

if [ ! -d "$DATADIR/mysql" ]; then
    if [ -n "$(find "$DATADIR" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
        echo "Directorio MySQL no vacío y sin tablas de sistema: $DATADIR; se detiene para proteger los datos." >&2
        exit 3
    fi
    chown -R mysql:mysql "$DATADIR"
    mysqld --initialize-insecure --user=mysql --datadir="$DATADIR"
    mysqld --user=mysql --datadir="$DATADIR" --socket=/run/mysqld/bootstrap.sock \
        --skip-networking --daemonize
    ready=0
    for attempt in $(seq 1 60); do
        if mysqladmin --protocol=socket --socket=/run/mysqld/bootstrap.sock -uroot ping >/dev/null 2>&1; then ready=1; break; fi
        sleep 1
    done
    if [ "$ready" != 1 ]; then echo 'MySQL no inició para bootstrap' >&2; exit 4; fi
    mysql --protocol=socket --socket=/run/mysqld/bootstrap.sock -uroot <<SQL
ALTER USER 'root'@'localhost' IDENTIFIED BY '${MYSQL_ROOT_PASSWORD}';
CREATE DATABASE \`${MYSQL_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER '${MYSQL_USER}'@'%' IDENTIFIED BY '${MYSQL_PASSWORD}';
GRANT ALL PRIVILEGES ON \`${MYSQL_DATABASE}\`.* TO '${MYSQL_USER}'@'%';
SQL
    MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqladmin --protocol=socket \
        --socket=/run/mysqld/bootstrap.sock -uroot shutdown
fi

if [ "$(stat -c %u "$DATADIR")" != "$(id -u mysql)" ]; then
    echo "El directorio de datos existente no pertenece al usuario mysql ($(id -u mysql)); revisa permisos sin recrear datos." >&2
    exit 5
fi
exec "$@" --datadir="$DATADIR" --socket="$SOCKET"
