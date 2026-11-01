"""Regression checks on the disposable MySQL test database."""
from uuid import uuid4

from app.config import settings
from app.db import SessionLocal
from app.models import Case, Draft, Event, MailAccount, MailAttachment, MailMessage


def request_key():
    return str(uuid4())


def create_customer(api):
    response = api.post('/api/clients', json={'name': 'Cliente de prueba', 'emails': ['cliente@example.test']})
    assert response.status_code == 201, response.text
    return response.json()


def create_case(api, client_id, kind='Cotización'):
    response = api.post('/api/cases', json={'client_id': client_id, 'subject': 'Trabajo de prueba', 'kind': kind})
    assert response.status_code == 201, response.text
    return response.json()


def test_three_new_types_without_origin_relation_or_automatic_order(clients):
    api = clients['admin']
    client = create_customer(api)
    for kind in ('Cotización', 'Solicitud', 'Reclamo'):
        record = create_case(api, client['id'], kind)
        assert record['kind'] == kind
        assert record['channel'] is None and record['related_case_id'] is None
        assert record['production_count'] == 0 and record['production'] is None
        assert record['owner_id'] is None and record['status'] == 'Abierto'
    for kind in ('Consulta', 'Seguimiento'):
        response = api.post('/api/cases', json={'client_id': client['id'], 'subject': 'Antiguo', 'kind': kind})
        assert response.status_code == 422
    for extra in ({}, {'channel': 'Presencial'}):
        response = api.post('/api/cases', json={'client_id': client['id'], 'subject': 'Inválido', **extra})
        assert response.status_code == 422
    related = api.post('/api/cases', json={
        'client_id': client['id'], 'subject': 'Relación por API', 'kind': 'Cotización',
        'related_case_id': record['id'],
    })
    assert related.status_code == 201, related.text
    assert related.json()['related_case_id'] == record['id']


def test_old_types_still_open_and_accept_normal_attention_updates(clients):
    api = clients['admin']
    client = create_customer(api)
    related = create_case(api, client['id'])
    agent_id = clients['agent'].get('/api/auth/me').json()['id']
    for kind in ('Consulta', 'Seguimiento'):
        record = create_case(api, client['id'])
        with SessionLocal.begin() as db:
            case = db.get(Case, record['id'])
            case.kind = kind
            case.related_case_id = related['id']
            case.channel = 'Llamada'
        record = api.get(f"/api/cases/{record['id']}").json()
        assert record['kind'] == kind and record['related_case_id'] == related['id'] and record['channel'] == 'Llamada'
        response = api.post(f"/api/cases/{record['id']}/take", json={'version': record['version'], 'key': request_key()})
        assert response.status_code == 200, response.text
        record = response.json()
        response = api.post(f"/api/cases/{record['id']}/assign", json={
            'version': record['version'], 'key': request_key(), 'owner_id': agent_id,
        })
        assert response.status_code == 200, response.text
        record = response.json()
        assert record['owner_id'] == agent_id
        response = api.post(f"/api/cases/{record['id']}/details", json={
            'version': record['version'], 'key': request_key(), 'next_action': 'Llamar el viernes',
        })
        assert response.status_code == 200, response.text
        record = response.json()
        assert record['next_action'] == 'Llamar el viernes'
        response = api.post(f"/api/cases/{record['id']}/events", json={
            'version': record['version'], 'key': request_key(), 'kind': 'Nota interna',
            'channel': 'Nota', 'body': 'Nota en solicitud histórica',
        })
        assert response.status_code == 200, response.text
        record = response.json()
        response = api.post(f"/api/cases/{record['id']}/attention", json={
            'version': record['version'], 'key': request_key(), 'status': 'Cerrado',
        })
        assert response.status_code == 200, response.text
        assert response.json()['kind'] == kind and response.json()['status'] == 'Cerrado'


def test_historical_messages_drafts_and_attachments_are_read_only(clients, tmp_path, monkeypatch):
    api = clients['admin']
    client = create_customer(api)
    record = create_case(api, client['id'])
    user_id = api.get('/api/auth/me').json()['id']
    storage_key = uuid4().hex
    (tmp_path / storage_key).write_bytes(b'archivo historico')
    monkeypatch.setattr(settings, 'upload_dir', str(tmp_path))
    with SessionLocal.begin() as db:
        account = MailAccount(email='historic@example.test', encrypted_password='ciphertext-preserved', active=True)
        db.add(account)
        db.flush()
        message = MailMessage(account_id=account.id, case_id=record['id'], direction='Saliente',
                              status='Pendiente', sender=account.email, to_addresses=['cliente@example.test'],
                              subject='Mensaje pendiente', body_text='Contenido histórico sin enviar')
        db.add(message)
        db.flush()
        attachment = MailAttachment(message_id=message.id, filename='historico.txt', mime='text/plain',
                                    storage_key=storage_key, size=17, sha256='0' * 64)
        db.add(attachment)
        db.add(Draft(case_id=record['id'], user_id=user_id, channel='Correo',
                     body='Borrador histórico', email_to='cliente@example.test', version=1))
        db.add(Event(case_id=record['id'], kind='Interacción manual', channel='WhatsApp',
                     body='Conversación externa histórica', data={'direction': 'Entrante'}))
        db.flush()
        account_id, message_id, attachment_id = account.id, message.id, attachment.id
    detail = api.get(f"/api/cases/{record['id']}")
    assert detail.status_code == 200, detail.text
    data = detail.json()
    assert data['email_messages'][0]['status'] == 'Pendiente'
    assert data['email_messages'][0]['body_text'] == 'Contenido histórico sin enviar'
    assert data['email_messages'][0]['attachments'][0]['filename'] == 'historico.txt'
    assert any(event['channel'] == 'WhatsApp' for event in data['events'])
    assert any(draft['channel'] == 'Correo' and draft['body'] == 'Borrador histórico' for draft in data['drafts'])
    assert api.get(f'/api/mail/attachments/{attachment_id}').content == b'archivo historico'
    assert clients['printer'].get(f'/api/mail/attachments/{attachment_id}').status_code == 404
    for method, path in (
        ('put', '/api/mail/config'), ('post', '/api/mail/test'),
        ('post', f"/api/cases/{record['id']}/email/send"),
        ('post', f'/api/mail/outbox/{message_id}/retry'),
        ('post', f'/api/mail/outbox/{message_id}/retry-copy'),
    ):
        assert getattr(api, method)(path, json={}).status_code == 410
    assert api.put(f"/api/cases/{record['id']}/drafts/Correo", json={'body': 'Sobrescribir', 'version': 1}).status_code == 422
    assert api.post(f"/api/cases/{record['id']}/events", json={
        'version': record['version'], 'key': request_key(), 'kind': 'Interacción manual',
        'channel': 'WhatsApp', 'body': 'Nuevo mensaje',
    }).status_code == 422
    with SessionLocal() as db:
        assert db.get(MailMessage, message_id).status == 'Pendiente'
        assert db.get(MailAccount, account_id).encrypted_password == 'ciphertext-preserved'
        assert db.get(Draft, data['drafts'][0]['id']).body == 'Borrador histórico'
