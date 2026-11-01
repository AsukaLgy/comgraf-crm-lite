"""No messaging operation is registered or launched by the application."""
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app import start
from app.main import app
from app.schemas import CaseInput, DraftInput, EventInput


@pytest.mark.parametrize('kind', ['Consulta', 'Seguimiento', '', 'Seleccionar tipo de atención'])
def test_old_or_placeholder_case_types_are_not_new_case_inputs(kind):
    with pytest.raises(ValidationError):
        CaseInput(client_id=1, subject='Prueba', kind=kind)


@pytest.mark.parametrize('kind', ['Cotización', 'Solicitud', 'Reclamo'])
def test_new_case_input_needs_no_origin_or_relation(kind):
    value = CaseInput(client_id=1, subject='Prueba', kind=kind)
    assert value.model_dump() == {
        'client_id': 1, 'contact_id': None, 'related_case_id': None, 'subject': 'Prueba',
        'description': '', 'kind': kind, 'priority': 'Normal',
    }


@pytest.mark.parametrize('method,path', [
    ('put', '/api/mail/config'), ('delete', '/api/mail/config'),
    ('post', '/api/mail/test'), ('post', '/api/cases/1/email/send'),
    ('post', '/api/cases/1/email/attend'),
    ('post', '/api/mail/outbox/1/retry'), ('post', '/api/mail/outbox/1/retry-copy'),
    ('post', '/api/mail/pending/1/classify'),
])
def test_old_mutation_urls_are_gone(method, path):
    client = TestClient(app, headers={'X-Comgraf-Request': '1', 'X-Comgraf-Contract': '4'})
    response = getattr(client, method)(path, json={}) if method != 'delete' else client.delete(path)
    client.close()
    assert response.status_code == 410
    assert response.json()['code'] == 'FEATURE_RETIRED'


def test_only_read_only_historical_attachment_route_remains():
    attachment_routes = [route for route in app.routes if route.path == '/api/mail/attachments/{attachment_id}']
    assert len(attachment_routes) == 1 and attachment_routes[0].methods == {'GET'}
    assert not any(route.path in {'/api/mail/config', '/api/mail/test', '/api/mail/outbox/{message_id}/retry'} for route in app.routes)


def test_generic_inputs_only_accept_notes():
    with pytest.raises(ValidationError):
        EventInput(version=1, key='abcdefghijklmnop', kind='Interacción manual', channel='WhatsApp', body='No crear')
    with pytest.raises(ValidationError):
        DraftInput(body='No crear', version=0, email_to='cliente@example.test')


def test_start_only_runs_migrations_and_web(monkeypatch):
    calls = []
    monkeypatch.setattr(start, 'configure_file_logging', lambda *_: None)
    monkeypatch.setattr(start.subprocess, 'run', lambda *args, **kwargs: calls.append(('migrations', args, kwargs)))
    monkeypatch.setattr(start.uvicorn, 'run', lambda *args, **kwargs: calls.append(('web', args, kwargs)))
    start.main()
    assert [name for name, *_ in calls] == ['migrations', 'web']
    assert calls[0][1][0][-3:] == ['alembic', 'upgrade', 'head']
