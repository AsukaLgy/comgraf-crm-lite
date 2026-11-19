"""Explicit fictional browser-test data. Never targets a real installation."""
import json
import secrets
from pathlib import Path
from app.test_database import configure_test_database, verify_test_database_identity

TEST_DATABASE = configure_test_database()
from app.config import settings
from app.db import engine
verify_test_database_identity(engine, TEST_DATABASE)
from app.db import SessionLocal
from app.models import User, Client, Case
from app.repository import normalize
from app.security import passwords

token = secrets.token_hex(4)
password = secrets.token_urlsafe(24)
scanner_password = secrets.token_urlsafe(24)
with SessionLocal.begin() as db:
    user = User(username='e2e_' + token, name='DEMO · Coordinación Comgraf', password_hash=passwords.hash(password), roles=['Administrador'], capacity=500)
    db.add(user)
    scanner = User(username='scan_' + token, name='DEMO · Escáner de encuadernación', password_hash=passwords.hash(scanner_password), roles=['Escáner de encuadernación'], capacity=20)
    db.add(scanner)
    db.flush()
    for name, subject, priority in [('DEMO · Café del Valle','Tarjetas para nueva sucursal','Alta'),('DEMO · Colegio Horizonte','Talonarios de matrícula','Normal'),('DEMO · Estudio Naranja','Consulta sobre impresión de portafolio','Normal')]:
        client = Client(name=name, company=name, search_text=normalize(name), phones=['+504 2222-0000'])
        db.add(client)
        db.flush()
        db.add(Case(client_id=client.id, subject=subject, priority=priority, kind='Cotización'))
    credentials = {'username':user.username,'password':password,'user_id':user.id,
        'scanner_username':scanner.username,'scanner_password':scanner_password,'scanner_user_id':scanner.id}
Path('../.runtime/e2e.json').write_text(json.dumps(credentials), encoding='utf-8')
print(f'Identidad temporal E2E creada en {TEST_DATABASE}. La base operativa no se modificó.')
