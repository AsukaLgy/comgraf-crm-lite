import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session
from app.models import Base, Case, Client, User
from app.deletion import delete_case, delete_client, preview_cases, preview_client


@pytest.fixture
def db():
    engine = create_engine('sqlite:///:memory:')
    @event.listens_for(engine, 'connect')
    def foreign_keys(connection, _):
        connection.execute('PRAGMA foreign_keys=ON')
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


def seed(db):
    admin = User(username='admin', name='Admin', password_hash='test', roles=['Administrador'])
    other = User(username='agent', name='Agent', password_hash='test', roles=['Atención'])
    customer = Client(name='Prueba', company='', rtn='', search_text='prueba')
    db.add_all([admin, other, customer]); db.flush()
    first = Case(client_id=customer.id, subject='Primera', kind='Solicitud')
    second = Case(client_id=customer.id, subject='Segunda', kind='Solicitud')
    db.add_all([first, second]); db.commit()
    return admin, other, customer, first, second


def test_delete_one_case_preserves_customer_and_sibling(db):
    admin, other, customer, first, second = seed(db)
    preview = preview_cases(db, [first])
    with pytest.raises(HTTPException) as denied:
        delete_case(db, other, first.id, preview)
    assert denied.value.status_code == 403
    delete_case(db, admin, first.id, preview); db.commit()
    assert db.get(Case, first.id) is None
    assert db.get(Case, second.id) is not None
    assert db.get(Client, customer.id) is not None


def test_client_scope_and_transaction_rollback(db, monkeypatch):
    admin, _, customer, first, second = seed(db)
    preview = preview_client(db, customer)
    with pytest.raises(HTTPException) as denied:
        delete_client(db, admin, customer.id, preview, False)
    assert denied.value.status_code == 409
    original = db.flush
    def fail():
        raise RuntimeError('simulated database failure')
    monkeypatch.setattr(db, 'flush', fail)
    with pytest.raises(RuntimeError):
        delete_client(db, admin, customer.id, preview, True)
    db.rollback()
    monkeypatch.setattr(db, 'flush', original)
    assert db.get(Client, customer.id) is not None
    assert db.get(Case, first.id) is not None
    assert db.get(Case, second.id) is not None
