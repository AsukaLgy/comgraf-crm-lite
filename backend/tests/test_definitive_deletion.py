from app.db import SessionLocal
from app.models import Case, Client, DeletionAudit
from test_workflows import create, must


def test_admin_deletes_one_case_and_other_roles_cannot(clients):
    admin = clients['admin']
    customer, first = create(admin, 'Eliminar esta solicitud')
    second = must(admin.post('/api/cases', json={'client_id': customer['id'], 'subject': 'Conservar esta solicitud', 'kind': 'Solicitud', 'creation_context': 'pool'}), 201)
    url = f"/api/cases/{first['id']}"
    assert clients['agent'].get(url + '/delete-preview').status_code == 403
    preview = must(admin.get(url + '/delete-preview'))
    payload = {'preview': preview, 'confirmation': first['number']}
    assert clients['agent'].post(url + '/delete-definitively', json=payload).status_code == 403
    must(admin.post(url + '/delete-definitively', json=payload))
    assert admin.get(url).status_code == 404
    assert admin.get(f"/api/cases/{second['id']}").status_code == 200
    assert admin.get(f"/api/clients/{customer['id']}").status_code == 200
    assert admin.post(url + '/delete-definitively', json=payload).status_code == 404
    with SessionLocal() as db:
        assert db.query(DeletionAudit).filter_by(record_type='case', record_id=first['id']).count() == 1


def test_client_requires_explicit_scope_and_rechecks_preview(clients):
    admin = clients['admin']
    customer, case = create(admin, 'Solicitud asociada')
    url = f"/api/clients/{customer['id']}"
    preview = must(admin.get(url + '/delete-preview'))
    payload = {'preview': preview, 'confirmation': 'comgraf'}
    assert admin.post(url + '/delete-definitively', json=payload).status_code == 409
    assert admin.get(f"/api/cases/{case['id']}").status_code == 200
    must(admin.post('/api/cases', json={'client_id': customer['id'], 'subject': 'Nueva dependencia', 'kind': 'Solicitud', 'creation_context': 'pool'}), 201)
    assert admin.post(url + '/delete-definitively', json={**payload, 'include_cases': True}).status_code == 409
    fresh = must(admin.get(url + '/delete-preview'))
    must(admin.post(url + '/delete-definitively', json={**payload, 'preview': fresh, 'include_cases': True}))
    assert admin.get(url).status_code == 404
    assert admin.get(f"/api/cases/{case['id']}").status_code == 404


def test_rtn_keeps_leading_zeroes(clients):
    admin = clients['admin']
    result = must(admin.post('/api/clients', json={'name': 'Cliente de prueba', 'rtn': '00123456789012'}), 201)
    assert result['rtn'] == '00123456789012'
    assert admin.post('/api/clients', json={'name': 'RTN incompleto', 'rtn': '0012'}).status_code == 422


def test_client_confirmation_word_and_admin_permission(clients):
    admin = clients['admin']
    customer = must(admin.post('/api/clients', json={'name': 'Confirmación ficticia'}), 201)
    url = f"/api/clients/{customer['id']}"
    preview = must(admin.get(url + '/delete-preview'))
    for word in ('', 'com', 'comgraf adicional', 'acomgraf', 'CLIENTE-' + str(customer['id'])):
        assert admin.post(url + '/delete-definitively', json={'preview': preview, 'confirmation': word}).status_code == 422
    assert clients['agent'].post(url + '/delete-definitively', json={'preview': preview, 'confirmation': 'comgraf'}).status_code == 403
    assert admin.get(url).status_code == 200
    for word in (' COMGRAF ', 'ComGraf', 'comgraf'):
        current = must(admin.post('/api/clients', json={'name': 'Confirmación ficticia ' + word.strip()}), 201)
        current_url = f"/api/clients/{current['id']}"
        current_preview = must(admin.get(current_url + '/delete-preview'))
        must(admin.post(current_url + '/delete-definitively', json={'preview': current_preview, 'confirmation': word}))
        assert admin.get(current_url).status_code == 404
