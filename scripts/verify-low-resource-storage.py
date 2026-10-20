"""Fail closed before Compose can start with missing or unsafe bind mounts."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess

REPO = Path(__file__).resolve().parents[1]
TEST_ROOT = (REPO / '.runtime' / 'lan-light-test-data').resolve()
REMOTE_FS = {'cifs', 'smb3', 'nfs', 'nfs4', 'sshfs', '9p'}


def read_env(path):
    values = {}
    for line in path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        values[key.strip()] = value.strip()
    return values


def mount_for(path):
    result = subprocess.run(['findmnt', '-n', '-o', 'TARGET,FSTYPE', '-T', str(path)],
                            capture_output=True, text=True)
    if result.returncode:
        raise SystemExit(f'No se pudo comprobar montaje para {path}: {result.stderr.strip()}')
    values = result.stdout.strip().split()
    if len(values) < 2:
        raise SystemExit(f'findmnt no identificó el montaje de {path}')
    return values[0], values[1].lower()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--env-file', required=True, type=Path)
    args = parser.parse_args()
    env_file = args.env_file.resolve()
    if not env_file.is_file():
        raise SystemExit(f'Falta {env_file}; ejecuta scripts/prepare-low-resource.py primero.')
    if env_file.stat().st_mode & 0o077:
        raise SystemExit(f'{env_file} permite lectura a grupo/otros. Ejecuta chmod 600.')
    if not shutil.which('findmnt'):
        raise SystemExit('No existe findmnt; no se inició Compose porque no se puede verificar el almacenamiento.')
    values = read_env(env_file)
    mysql = Path(values.get('MYSQL_DATA_DIR', '')).resolve()
    app = Path(values.get('APP_DATA_DIR', '')).resolve()
    if not mysql.is_dir() or not app.is_dir():
        raise SystemExit('Falta el directorio de datos configurado; no se crearán bind mounts silenciosos.')
    for relative in ('uploads', 'test-uploads', 'mail-secrets', 'logs/app', 'logs/mysql', 'backups'):
        if not (app / relative).is_dir():
            raise SystemExit(f'Falta {app / relative}; vuelve a preparar el perfil sin borrar datos.')
    mysql_mount, mysql_type = mount_for(mysql)
    app_mount, app_type = mount_for(app)
    if mysql_type in REMOTE_FS or mysql_type.startswith('fuse.ssh'):
        raise SystemExit(f'MySQL está en {mysql_type}; usa almacenamiento local, nunca SMB/NFS.')
    if app_type in REMOTE_FS or app_type.startswith('fuse.ssh'):
        raise SystemExit(f'Adjuntos/secretos están en {app_type}; esta configuración experimental requiere almacenamiento local.')
    if values.get('LOW_RESOURCE_TEST_MODE') == '1':
        try:
            mysql.relative_to(TEST_ROOT)
            app.relative_to(TEST_ROOT)
        except ValueError:
            raise SystemExit('--test-mode solo se permite con rutas bajo .runtime/lan-light-test-data.')
    elif mysql_mount == '/':
        raise SystemExit(f'MySQL resolvería al sistema de archivos raíz ({mysql_mount}); monta el disco de base antes de iniciar.')
    print(f'Almacenamiento verificado: MySQL {mysql} ({mysql_type}, montaje {mysql_mount}); aplicación {app} ({app_type}, montaje {app_mount}).')


if __name__ == '__main__':
    main()
