"""Integration tests exclusively against a disposable real MySQL schema."""
import secrets
import subprocess
import sys
import pytest

from app.test_database import configure_test_database, verify_test_database_identity

TEST_DATABASE = configure_test_database()
from app.db import SessionLocal, engine, Base
from app.models import User
from app.security import passwords
from app.main import app
from fastapi.testclient import TestClient
from sqlalchemy import text


@pytest.fixture(scope='session', autouse=True)
def migrate():
    identity = verify_test_database_identity(engine, TEST_DATABASE)
    print(f'Base de pruebas verificada: {identity}')
    subprocess.run([sys.executable, '-m', 'alembic', 'upgrade', 'head'], check=True)


@pytest.fixture()
def accounts(migrate):
    verify_test_database_identity(engine, TEST_DATABASE)
    # Only test data, preserving role definitions and migration version.
    with engine.begin() as conn:
        conn.execute(text('UPDATE ledger SET reverses_id = NULL WHERE reverses_id IS NOT NULL'))
        conn.execute(text('UPDATE cases SET related_case_id = NULL WHERE related_case_id IS NOT NULL'))
        conn.execute(text('UPDATE mail_messages SET retry_of_id = NULL WHERE retry_of_id IS NOT NULL'))
        for table in reversed(Base.metadata.sorted_tables):
            if table.name != 'roles': conn.execute(table.delete())
    credentials = {}
    with SessionLocal.begin() as db:
        for role, name in [('Administrador','admin'), ('Coordinador','coordinator'), ('Atención','agent'), ('Atención','agent2'), ('Producción','printer'), ('Cobranza','cashier'), ('Escáner de encuadernación','scanner'), ('Escáner de encuadernación','scanner2')]:
            password = secrets.token_urlsafe(20)
            user = User(username=name, name=name.title(), password_hash=passwords.hash(password), roles=[role], capacity=30)
            db.add(user)
            db.flush()
            credentials[name] = {'id': user.id, 'password': password}
    return credentials


@pytest.fixture()
def clients(accounts):
    instances = {}
    for name, info in accounts.items():
        client = TestClient(app, headers={'X-Comgraf-Request':'1', 'X-Comgraf-Contract':'5', 'X-Comgraf-Build':'1.4.0'})
        response = client.post('/api/auth/login', json={'username':name, 'password':info['password']})
        assert response.status_code == 200, response.text
        instances[name] = client
    yield instances
    for client in instances.values(): client.close()
