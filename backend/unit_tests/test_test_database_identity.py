from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.test_database import verify_test_database_identity


SERVER_UUID = '123e4567-e89b-12d3-a456-426614174000'


class FakeEngine:
    dialect = SimpleNamespace(name='mysql')
    url = SimpleNamespace(database='comgraf_delete_test', host='127.0.0.1', port=3309)

    def __init__(self, identity):
        self.identity = identity
        result = MagicMock()
        result.one.return_value = identity
        self.connection = MagicMock()
        self.connection.execute.return_value = result
        self.connection.__enter__.return_value = self.connection

    def connect(self):
        return self.connection


def test_missing_expected_mysql_uuid_aborts_before_connecting(monkeypatch):
    monkeypatch.delenv('TEST_MYSQL_SERVER_UUID', raising=False)
    engine = FakeEngine(('comgraf_delete_test', 'mysql-test', 3309, SERVER_UUID))

    with pytest.raises(RuntimeError, match='TEST_MYSQL_SERVER_UUID'):
        verify_test_database_identity(engine, 'comgraf_delete_test')

    engine.connection.execute.assert_not_called()


def test_unexpected_mysql_uuid_aborts(monkeypatch):
    monkeypatch.setenv('TEST_MYSQL_SERVER_UUID', SERVER_UUID)
    engine = FakeEngine(('comgraf_delete_test', 'mysql-test', 3309, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'))

    with pytest.raises(RuntimeError, match='UUID.*no coincide'):
        verify_test_database_identity(engine, 'comgraf_delete_test')


def test_matching_mysql_uuid_confirms_identity(monkeypatch):
    monkeypatch.setenv('TEST_MYSQL_SERVER_UUID', SERVER_UUID)
    engine = FakeEngine(('comgraf_delete_test', 'mysql-test', 3309, SERVER_UUID))

    identity = verify_test_database_identity(engine, 'comgraf_delete_test')

    assert f'UUID {SERVER_UUID}' in identity
