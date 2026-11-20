"""Safety checks for destructive integration-test database operations."""
import os
from uuid import UUID

from sqlalchemy import text


def _expected_server_uuid():
    expected = os.getenv('TEST_MYSQL_SERVER_UUID', '').strip().lower()
    if not expected:
        raise RuntimeError(
            'Define TEST_MYSQL_SERVER_UUID con el UUID esperado del servidor MySQL de pruebas.'
        )
    try:
        if str(UUID(expected)) != expected:
            raise ValueError
    except ValueError:
        raise RuntimeError('TEST_MYSQL_SERVER_UUID debe ser un UUID MySQL válido.') from None
    return expected


def configure_test_database():
    """Select a test schema and refuse the configured service database by default."""
    from . import config

    service_database = config.settings.mysql_database
    test_database = os.getenv('TEST_MYSQL_DATABASE', '').strip()
    _expected_server_uuid()
    isolated_profile = os.getenv('LOW_RESOURCE_TEST_MODE') == '1'

    if not test_database:
        raise RuntimeError(
            'Define TEST_MYSQL_DATABASE explícitamente. Las pruebas no usarán una base por defecto.'
        )
    if not test_database.endswith('_test'):
        raise RuntimeError('La base de pruebas debe terminar en _test.')
    if test_database == service_database and not isolated_profile:
        raise RuntimeError(
            'La base de pruebas coincide con MYSQL_DATABASE. Usa una base separada '
            'o prepara el perfil aislado con --test-mode.'
        )
    if isolated_profile and test_database != service_database:
        raise RuntimeError(
            'En el perfil --test-mode, TEST_MYSQL_DATABASE debe coincidir con la base '
            'del servicio de prueba aislado.'
        )

    os.environ['MYSQL_DATABASE'] = test_database
    os.environ['UPLOAD_DIR'] = os.getenv(
        'TEST_UPLOAD_DIR', '../.runtime/test-uploads'
    )
    config.settings = config.Settings()
    return test_database


def verify_test_database_identity(engine, expected_database):
    """Confirm the live MySQL endpoint and selected schema before any mutation."""
    expected_server_uuid = _expected_server_uuid()
    if engine.dialect.name != 'mysql':
        raise RuntimeError('Las pruebas destructivas solo pueden usar MySQL.')
    if engine.url.database != expected_database:
        raise RuntimeError(
            f'El motor apunta a {engine.url.database!r}, no a la base de prueba esperada.'
        )

    with engine.connect() as connection:
        actual_database, server, server_port, server_uuid = connection.execute(
            text('SELECT DATABASE(), @@hostname, @@port, @@server_uuid')
        ).one()

    if actual_database != expected_database:
        raise RuntimeError(
            f'MySQL seleccionó {actual_database!r}, no la base de prueba esperada '
            f'{expected_database!r}.'
        )
    if not server or not server_port:
        raise RuntimeError('MySQL no devolvió una identidad de servidor verificable.')
    if not server_uuid or str(server_uuid).lower() != expected_server_uuid:
        raise RuntimeError(
            'El UUID del servidor MySQL no coincide con TEST_MYSQL_SERVER_UUID; '
            'se abortó antes de modificar datos.'
        )
    configured_port = engine.url.port or 3306
    if int(server_port) != configured_port:
        raise RuntimeError(
            f'El servidor MySQL respondió en el puerto {server_port}, '
            f'pero el destino configurado usa {configured_port}.'
        )
    return f'{expected_database} @ {engine.url.host}:{configured_port} (MySQL {server}, UUID {server_uuid})'
