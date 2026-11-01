"""Create five fictional load-test users and requests in an isolated *_test DB."""
import json
import os
from pathlib import Path
import secrets

from app.config import settings
from app.db import SessionLocal
from app.models import Case, Client, User
from app.repository import client_search_text
from app.security import passwords


def main():
    if not settings.mysql_database.endswith('_test'):
        raise SystemExit('Refusing to seed: MYSQL_DATABASE must end in _test.')
    token = secrets.token_hex(4)
    credentials = {'environment': 'test-only', 'users': []}
    target = Path(os.getenv(
        'LOW_RESOURCE_CREDENTIALS_FILE',
        '/data/test-uploads/low-resource-test-users.json',
    ))
    if target.exists():
        raise SystemExit(f'{target} already exists; move it aside explicitly before seeding again.')
    target.parent.mkdir(parents=True, exist_ok=True)
    # Fail before mutating MySQL if the credentials directory is not writable.
    probe = target.parent / f'.{target.name}.{secrets.token_hex(4)}.probe'
    try:
        probe.touch(mode=0o600, exist_ok=False)
    except OSError as exc:
        raise SystemExit(f'Credentials directory is not writable: {target.parent}') from exc
    else:
        probe.unlink()
    with SessionLocal.begin() as db:
        for index in range(1, 6):
            password = secrets.token_urlsafe(24)
            user = User(username=f'lan_{token}_{index}', name=f'DEMO · Usuario LAN {index}',
                        password_hash=passwords.hash(password), roles=['Administrador'], capacity=40)
            db.add(user)
            db.flush()
            client = Client(name=f'DEMO LAN-TEST Cliente {index}', company=f'DEMO LAN-TEST Empresa {index}',
                            phones=[f'+504 2200-00{index:02d}'], emails=[f'lan-test-{index}@example.test'],
                            provisional=False)
            client.search_text = client_search_text(client)
            db.add(client)
            db.flush()
            case = Case(client_id=client.id, subject=f'DEMO LAN-TEST solicitud operativa {index}',
                        owner_id=user.id, priority='Normal', kind='Cotización')
            db.add(case)
            db.flush()
            credentials['users'].append({'username': user.username, 'password': password,
                                         'user_id': user.id, 'case_id': case.id})
    temporary = target.with_name(f'.{target.name}.{secrets.token_hex(4)}.tmp')
    try:
        temporary.write_text(json.dumps(credentials, ensure_ascii=False, indent=2), encoding='utf-8')
        temporary.chmod(0o600)
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
    print(f'Five fictional test users and requests created in {settings.mysql_database}; credentials saved mode 600 to {target}.')


if __name__ == '__main__':
    main()
