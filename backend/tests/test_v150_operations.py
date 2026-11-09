from app.db import SessionLocal
from app.models import Delivery, Ledger
from test_workflows import create, conversion, key, must, mutate


def test_version_reports_product_and_independent_contract(clients):
    version = must(clients['admin'].get('/api/version'))
    assert version['product_version'] == '1.5.0'
    assert version['contract_version'] == '5'
    assert version['commit'] and version['build_date']


def test_admin_changes_only_selected_order_without_financial_side_effects(clients):
    admin = clients['admin']
    _, case = create(admin, 'Dos OP de prueba')
    first = mutate(admin, case, 'convert', conversion())
    first_id = first['production']['id']
    second = mutate(admin, first, 'convert', conversion())
    second_id = second['production']['id']
    before = must(admin.get(f"/api/cases/{case['id']}?production_id={first_id}"))
    with SessionLocal() as db:
        deliveries = db.query(Delivery).filter_by(case_id=case['id']).count()
        ledger = db.query(Ledger).filter_by(case_id=case['id']).count()
    body = {'version': before['version'], 'key': key(), 'production_id': first_id, 'stage': 'READY'}
    assert clients['printer'].post(f"/api/cases/{case['id']}/production/admin-stage", json=body).status_code == 403
    changed = must(admin.post(f"/api/cases/{case['id']}/production/admin-stage", json=body))
    assert changed['production']['id'] == first_id and changed['production']['stage'] == 'READY'
    assert changed['production']['binding_confirmed_at'] is None
    assert changed['production_count'] == 2
    assert must(admin.get(f"/api/cases/{case['id']}?production_id={second_id}"))['production']['stage'] == 'APPROVAL'
    assert any(e['data'].get('origin') == 'admin_manual' and e['data'].get('production_id') == first_id for e in changed['events'])
    with SessionLocal() as db:
        assert db.query(Delivery).filter_by(case_id=case['id']).count() == deliveries
        assert db.query(Ledger).filter_by(case_id=case['id']).count() == ledger
    back = must(admin.post(f"/api/cases/{case['id']}/production/admin-stage", json={'version': changed['version'], 'key': key(), 'production_id': first_id, 'stage': 'PRINTING'}))
    assert back['production']['stage'] == 'PRINTING'
    assert admin.post(f"/api/cases/{case['id']}/production/admin-stage", json={'version': changed['version'], 'key': key(), 'production_id': first_id, 'stage': 'WORKSHOP'}).status_code == 409


def test_title_edit_checks_version_and_scanner_qr_scope(clients):
    admin = clients['admin']
    _, case = create(admin, 'Título original')
    assert clients['scanner'].patch(f"/api/cases/{case['id']}/title", json={'version': case['version'], 'title': 'No autorizado'}).status_code == 403
    changed = must(admin.patch(f"/api/cases/{case['id']}/title", json={'version': case['version'], 'title': '  Título corregido  '}))
    assert changed['subject'] == 'Título corregido'
    assert admin.patch(f"/api/cases/{case['id']}/title", json={'version': case['version'], 'title': 'Título obsoleto'}).status_code == 409
    assert admin.patch(f"/api/cases/{case['id']}/title", json={'version': changed['version'], 'title': '   '}).status_code == 422
    order = mutate(admin, changed, 'convert', conversion())
    printer_title = must(clients['printer'].patch(f"/api/cases/{case['id']}/title", json={
        'version': order['version'], 'title': 'Corrección de producción'}))
    assert printer_title['subject'] == 'Corrección de producción'
    qr = 'CGOP1:' + order['production']['scan_id']
    scanned = must(clients['scanner'].post('/api/scanner/title', json={'scan_id': qr, 'version': printer_title['version'], 'title': '  Corrección escáner '}))
    assert scanned['title'] == 'Corrección escáner'
    assert clients['scanner'].post('/api/scanner/title', json={'scan_id': 'CGOP1:00000000-0000-4000-8000-000000000000', 'version': scanned['version'], 'title': 'Sin QR'}).status_code == 404
