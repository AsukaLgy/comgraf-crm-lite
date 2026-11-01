"""Channel pause checks that never connect to a database or a mail server."""
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.db import get_db
from app.main import app
from app.mail_transport import MailFailure
from app import mail_service, mail_transport, mail_worker
from app.security import current_user
from app import security


class NoDatabase:
    def __getattr__(self, name):
        raise AssertionError(f'Unexpected database access: {name}')


@pytest.fixture
def paused(monkeypatch):
    monkeypatch.setattr(settings, 'mail_channel_enabled', False)
    monkeypatch.setattr(settings, 'whatsapp_channel_enabled', False)
    monkeypatch.setattr(settings, 'mail_worker_enabled', False)
    app.dependency_overrides[current_user] = lambda: SimpleNamespace(id=1)
    app.dependency_overrides[get_db] = lambda: NoDatabase()
    yield TestClient(app, headers={'X-Comgraf-Request': '1', 'X-Comgraf-Contract': '4'})
    app.dependency_overrides.clear()


@pytest.mark.parametrize(('method', 'path', 'body'), [
    ('put', '/api/mail/config', {'email': 'demo@example.com', 'application_password': 'secret'}),
    ('delete', '/api/mail/config', None),
    ('post', '/api/mail/test', {'send_key': 'abcdefghijklmnop'}),
    ('post', '/api/cases/1/email/send', {'to': ['demo@example.com'], 'subject': 'Prueba', 'body': 'Texto', 'send_key': 'abcdefghijklmnop'}),
    ('post', '/api/mail/outbox/1/retry', {'confirm_uncertain': False}),
    ('post', '/api/mail/outbox/1/retry-copy', {}),
    ('post', '/api/mail/pending/1/classify', {'action': 'ignore'}),
])
def test_mutations_are_blocked_before_database_or_network(paused, method, path, body):
    response = getattr(paused, method)(path, json=body) if body is not None else getattr(paused, method)(path)
    assert response.status_code == 409
    assert response.json()['code'] == 'CHANNEL_DISABLED'
    assert 'temporalmente deshabilitada' in response.json()['detail']


def test_transport_and_direct_worker_cannot_connect_or_change_queue(paused, monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError('Unexpected external connection or worker task')

    monkeypatch.setattr(mail_transport.imaplib, 'IMAP4_SSL', forbidden)
    monkeypatch.setattr(mail_transport.smtplib, 'SMTP_SSL', forbidden)
    monkeypatch.setattr(mail_worker.threading.Thread, 'start', forbidden)
    assert settings.public_channels == {'mail': False, 'whatsapp': False}
    for operation in (
        lambda: mail_transport.open_imap(),
        lambda: mail_transport.check_credentials('demo@example.com', 'secret'),
        lambda: mail_transport.smtp_send('demo@example.com', 'secret', ['demo@example.com'], b'x'),
        lambda: mail_transport.append_sent_copy('demo@example.com', 'secret', '<id>', b'x'),
    ):
        with pytest.raises(MailFailure, match='channel_disabled'):
            operation()
    monkeypatch.setattr(settings, 'mail_worker_enabled', True)
    mail_worker.run_worker_threads()
    assert mail_worker._outbox_once(1) == (True, None)
    assert mail_worker._inbox_once(1) == (True, None)
    assert mail_worker._copy_once(1) == (True, None)
    for operation in (
        lambda: mail_service.process_outbox_message(forbidden, 1),
        lambda: mail_service.process_sent_copy(forbidden, 1),
        lambda: mail_service.recover_stuck_outbox(forbidden),
        lambda: mail_service.sync_account(forbidden, 1),
    ):
        operation()
    with pytest.raises(MailFailure, match='channel_disabled'):
        mail_service.retry_sent_copy(forbidden, 1)


def test_authenticated_public_config_contains_only_channel_flags(paused, monkeypatch):
    monkeypatch.setattr(security, 'permissions', lambda db, user: {'*'})
    app.dependency_overrides[current_user] = lambda: SimpleNamespace(
        id=1, username='admin', name='Admin', roles=['Administrador'], active=True, capacity=20,
    )
    response = paused.get('/api/auth/me')
    assert response.status_code == 200
    assert response.json()['channels'] == {'mail': False, 'whatsapp': False}
    assert 'password' not in response.text and 'secret' not in response.text


def test_worker_flag_does_not_define_channel_availability(paused, monkeypatch):
    monkeypatch.setattr(settings, 'mail_channel_enabled', True)
    assert settings.mail_worker_enabled is False
    assert settings.public_channels['mail'] is True
