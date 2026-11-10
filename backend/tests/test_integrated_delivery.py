"""Regresiones de entrega y cobro sobre la base MySQL desechable `_test`."""
from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor

from app.db import SessionLocal
from app.models import Production
from app.repository import today
from test_workflows import create, conversion, key, must, mutate, release_single_order


def ready(clients, *, terms='Contado', due=None):
    api = clients['admin']
    _, case = create(api, 'Entrega integrada')
    case = mutate(api, case, 'convert', {**conversion(), 'payment_terms': terms,
                                      'payment_due_date': str(due or today() + timedelta(days=7))})
    return release_single_order(clients, case)


def delivery(api, case, **changes):
    payload = {'version': case['version'], 'key': key(), 'production_id': case['production']['id'],
               'method': 'Retiro en local', 'receiver': 'Cliente', 'evidence': 'Recibo de prueba', **changes}
    return api.post(f"/api/cases/{case['id']}/deliveries/complete", json=payload), payload


def test_cash_full_collection_is_atomic_and_idempotent(clients):
    api = clients['admin']
    case = ready(clients)
    response, payload = delivery(api, case, payment_amount='1000.00', payment_reference='Recibo 1')
    delivered = must(response)
    assert delivered['delivery_status'] == 'Completa' and delivered['balance'] == '0.00'
    assert delivered['lifecycle'] == 'Activo'
    assert len(delivered['deliveries']) == 1 and len(delivered['ledger']) == 2
    replay = must(api.post(f"/api/cases/{case['id']}/deliveries/complete", json=payload))
    assert len(replay['deliveries']) == 1 and len(replay['ledger']) == 2
    assert api.post(f"/api/cases/{case['id']}/deliveries/complete", json={**payload, 'key': key(), 'version': replay['version']}).status_code == 409


def test_concurrent_integrated_collections_create_only_one_payment(clients):
    api = clients['admin']
    case = ready(clients)
    payloads = [{ 'version': case['version'], 'key': key(), 'production_id': case['production']['id'],
                  'method': 'Retiro en local', 'receiver': 'Cliente', 'evidence': 'Concurrencia',
                  'payment_amount': '1000.00', 'payment_reference': reference }
                for reference in ('Recibo A', 'Recibo B')]
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda body: api.post(f"/api/cases/{case['id']}/deliveries/complete", json=body), payloads))
    assert sorted(response.status_code for response in responses) == [200, 409]
    refreshed = must(api.get(f"/api/cases/{case['id']}"))
    assert len(refreshed['deliveries']) == 1 and len(refreshed['ledger']) == 2
    assert refreshed['balance'] == '0.00'


def test_advance_then_collect_remainder_and_paid_delivery(clients):
    api = clients['admin']
    case = ready(clients)
    case = mutate(api, case, 'payments', {'amount': '250.00', 'kind': 'Anticipo', 'reference': 'Anticipo'})
    collected = must(delivery(api, case, payment_amount='750.00', payment_reference='Saldo')[0])
    assert collected['balance'] == '0.00' and len(collected['ledger']) == 3
    case = ready(clients)
    case = mutate(api, case, 'payments', {'amount': '1000.00', 'kind': 'Anticipo', 'reference': 'Pagado antes'})
    paid = must(delivery(api, case)[0])
    assert paid['balance'] == '0.00' and len(paid['ledger']) == 2


def test_credit_and_exception_reasons(clients):
    api = clients['admin']
    credit = ready(clients, terms='Crédito', due=today() + timedelta(days=5))
    delivered = must(delivery(api, credit)[0])
    assert delivered['balance'] == '1000.00'
    assert any(e['data'].get('balance_reason') == 'Crédito acordado' for e in delivered['events'])
    cash = ready(clients)
    assert delivery(api, cash)[0].status_code == 422
    assert must(api.get(f"/api/cases/{cash['id']}"))['deliveries'] == []
    exceptional = must(delivery(api, cash, balance_reason='Cliente retira y pagará mañana')[0])
    assert exceptional['balance'] == '1000.00'
    overdue_credit = ready(clients, terms='Crédito', due=today() - timedelta(days=1))
    assert delivery(api, overdue_credit)[0].status_code == 422


def test_partial_payment_permissions_and_order_scope(clients):
    api = clients['admin']
    case = ready(clients)
    assert delivery(clients['printer'], case, payment_amount='500.00', payment_reference='Prohibido',
                    balance_reason='Motivo')[0].status_code == 403
    assert clients['printer'].post(f"/api/cases/{case['id']}/payments", json={
        'version': case['version'], 'key': key(), 'production_id': case['production']['id'],
        'amount': '1.00', 'reference': 'Prohibido'}).status_code == 403
    delivered = must(delivery(api, case, payment_amount='400.00', payment_reference='Parcial',
                              balance_reason='Saldo contra transferencia')[0])
    assert delivered['balance'] == '600.00'
    actor_id = must(api.get('/api/auth/me'))['id']
    followup = {'purpose': 'COLLECTION', 'production_id': case['production']['id'],
                'owner_id': actor_id, 'title': 'Llamar por saldo',
                'due_at': (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()}
    delivered = mutate(api, delivered, 'tasks', followup)
    assert any(task['production_id'] == case['production']['id'] and task['purpose'] == 'COLLECTION'
               for task in delivered['tasks'])
    assert api.post(f"/api/cases/{case['id']}/tasks", json={**followup, 'version': delivered['version'],
                                                            'key': key()}).status_code == 409
    restricted = must(clients['printer'].get(f"/api/cases/{case['id']}?production_id={case['production']['id']}"))
    assert 'balance' not in restricted and 'price' not in restricted['production']
    assert 'payments_received' not in restricted['productions'][0] and restricted['ledger'] == []
    assert not any('400.00' in event['body'] for event in restricted['events'])
    assert must(api.get('/api/orders?view=delivered-balances'))['total'] == 1
    assert must(api.get('/api/indicators'))['collection']['delivered_pending'] == 1

    other = mutate(api, delivered, 'convert', conversion())
    first_id, second_id = delivered['production']['id'], other['production']['id']
    with SessionLocal.begin() as db:
        db.get(Production, second_id).stage = 'READY'
    other = must(api.get(f"/api/cases/{case['id']}?production_id={second_id}"))
    second = must(delivery(api, other, balance_reason='Pago al retirar')[0])
    assert second['delivery_status'] == 'Completa' and second['balance'] == '1000.00'
    first = must(api.get(f"/api/cases/{case['id']}?production_id={first_id}"))
    assert first['balance'] == '600.00' and len(first['deliveries']) == 1


def test_catalog_family_and_historical_mapping(clients):
    from app.schemas import ItemInput
    from app.cai import is_cai_product, uses_print_form
    from test_cai_forms import cai_item
    for product in ('Recibos por honorarios (CAI)', 'Facturas (CAI)', 'Otros (CAI)', 'Talonarios y facturas'):
        validated = ItemInput.model_validate(cai_item(product=product))
        assert uses_print_form(validated.product)
        assert is_cai_product(product) == (product != 'Talonarios y facturas')
    api = clients['admin']
    _, case = create(api, 'Producto histórico')
    order = mutate(api, case, 'convert', {**conversion(), 'items': [cai_item()]})
    assert order['items'][0]['product'] == 'Facturas (CAI)'
    assert order['production']['specs_snapshot']['items'][0]['product'] == 'Facturas (CAI)'


def test_nonpersonal_creation_defaults_to_pool_and_extra_order_keeps_owner(clients, accounts):
    api = clients['admin']
    customer = must(api.post('/api/clients', json={'name': 'Asignación por acceso'}), 201)
    pool = must(api.post('/api/cases', json={'client_id': customer['id'], 'subject': 'Perfil o Mi día',
                                            'kind': 'Solicitud'}), 201)
    assert pool['owner_id'] is None
    personal = must(api.post('/api/cases', json={'client_id': customer['id'], 'subject': 'Mis solicitudes',
                                                'kind': 'Solicitud', 'creation_context': 'personal'}), 201)
    assert personal['owner_id'] == accounts['admin']['id']
    first = mutate(api, personal, 'convert', conversion())
    second = mutate(api, first, 'convert', conversion())
    assert second['owner_id'] == personal['owner_id']
    assert second['production_count'] == 2


def test_indicator_counts_open_matching_order_baskets(clients):
    api = clients['admin']
    case = ready(clients)
    indicator = must(api.get('/api/indicators'))
    assert (datetime.fromisoformat(indicator['period']['through']) -
            datetime.fromisoformat(indicator['period']['from'])).days == 29
    assert indicator['current']['ready_orders'] == must(api.get('/api/orders?view=ready'))['total'] == 1
    assert indicator['pickup']['unpaid'] == must(api.get('/api/orders?view=ready&pickup=unpaid'))['total'] == 1
    delivered = must(delivery(api, case, balance_reason='Pago pendiente documentado')[0])
    indicator = must(api.get('/api/indicators'))
    assert indicator['collection']['delivered_pending'] == must(api.get('/api/orders?view=delivered-balances'))['total'] == 1
    assert indicator['compliance']['denominator'] == must(api.get('/api/orders?view=delivered-period&commitment=dated'))['total'] == 1
    assert indicator['compliance']['numerator'] == must(api.get('/api/orders?view=delivered-period&commitment=ontime'))['total'] == 1
    assert delivered['lifecycle'] == 'Activo'


def test_missing_credit_due_date_is_not_fabricated(clients):
    api = clients['admin']
    _, case = create(api, 'Crédito sin vencimiento acordado')
    body = conversion()
    body.pop('payment_due_date')
    body['payment_terms'] = 'Crédito'
    case = mutate(api, case, 'convert', body)
    assert case['production']['payment_due_date'] is None
    case = release_single_order(clients, case)
    assert delivery(api, case)[0].status_code == 422
    delivered = must(delivery(api, case, balance_reason='Pendiente de acordar fecha de pago')[0])
    assert delivered['balance'] == '1000.00'
    assert not any(event['event_kind'] == 'payment_due' and event['production_id'] == case['production']['id']
                   for event in must(api.get('/api/calendar')))
