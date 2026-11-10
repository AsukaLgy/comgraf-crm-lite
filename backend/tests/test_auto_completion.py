"""Completion uses the same transaction and OP balance as delivery and payment."""
from datetime import datetime, timedelta, timezone

from app.repository import today
from test_integrated_delivery import delivery, ready
from test_workflows import create, conversion, key, must, mutate, release_single_order


def completions(record):
    return [event for event in record['events'] if event['data'].get('action') == 'case_completed']


def test_zero_value_order_completes_without_fictitious_payment(clients):
    api = clients['admin']
    _, case = create(api, 'OP sin cargo')
    data = conversion()
    data['items'][0]['unit_price'] = '0.00'
    data['advance_required'] = '0.00'
    case = release_single_order(clients, mutate(api, case, 'convert', data))
    assert case['balance'] == '0.00' and case['lifecycle'] == 'Activo'
    saved = must(delivery(api, case)[0])
    assert saved['lifecycle'] == 'Completado' and saved['status'] == 'Cerrado'
    assert [entry['kind'] for entry in saved['ledger']] == ['Obligación']
    assert len(completions(saved)) == 1
    assert completions(saved)[0]['data']['origin'] == 'automatic'
    assert completions(saved)[0]['data']['action_trigger'] == 'delivery_completed'
    assert all(task['done_at'] for task in saved['tasks'] if task['category'] == 'PICKUP')
    assert must(api.get('/api/cases?view=pool'))['total'] == 0


def test_prepaid_order_waits_for_delivery_and_last_payment_completes(clients):
    api = clients['admin']
    prepaid = ready(clients)
    prepaid = mutate(api, prepaid, 'payments', {'amount': '1000.00', 'reference': 'Prepagado'})
    assert prepaid['lifecycle'] == 'Activo' and prepaid['delivery_status'] != 'Completa'
    assert must(delivery(api, prepaid)[0])['lifecycle'] == 'Completado'

    owed = ready(clients)
    owed = must(delivery(api, owed, balance_reason='Pago pendiente acordado')[0])
    assert owed['lifecycle'] == 'Activo' and owed['balance'] == '1000.00'
    actor_id = must(api.get('/api/auth/me'))['id']
    owed = mutate(api, owed, 'tasks', {'purpose': 'COLLECTION', 'production_id': owed['production']['id'],
        'owner_id': actor_id, 'title': 'Cobrar saldo',
        'due_at': (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()})
    paid = mutate(api, owed, 'payments', {'amount': '1000.00', 'reference': 'Saldo final'})
    assert paid['lifecycle'] == 'Completado' and paid['balance'] == '0.00'
    assert len(completions(paid)) == 1 and completions(paid)[0]['data']['action_trigger'] == 'payment'
    assert all(task['done_at'] for task in paid['tasks'] if task['purpose'] == 'COLLECTION')


def test_multiple_orders_and_cross_balances_never_complete_early(clients):
    api = clients['admin']
    _, case = create(api, 'Dos OP separadas')
    first = mutate(api, case, 'convert', conversion())
    first_id = first['production']['id']
    second = mutate(api, first, 'convert', conversion())
    second_id = second['production']['id']
    for order_id in (first_id, second_id):
        second = mutate(api, second, 'production/admin-stage', {'production_id': order_id, 'stage': 'READY'})
    first_view = must(api.get(f"/api/cases/{case['id']}?production_id={first_id}"))
    first_view = must(delivery(api, first_view, payment_amount='1000.00', payment_reference='OP primera')[0])
    assert first_view['lifecycle'] == 'Activo'
    second_view = must(api.get(f"/api/cases/{case['id']}?production_id={second_id}"))
    second_view = must(delivery(api, second_view, balance_reason='Saldo segunda OP')[0])
    assert second_view['lifecycle'] == 'Activo'
    second_view = mutate(api, second_view, 'payments', {'production_id': second_id, 'amount': '1000.00', 'reference': 'OP segunda'})
    assert second_view['lifecycle'] == 'Completado' and len(completions(second_view)) == 1

    other = ready(clients)
    first_id = other['production']['id']
    other = mutate(api, other, 'convert', conversion())
    second_id = other['production']['id']
    other = mutate(api, other, 'production/admin-stage', {'production_id': second_id, 'stage': 'READY'})
    first_view = must(api.get(f"/api/cases/{other['id']}?production_id={first_id}"))
    first_view = must(delivery(api, first_view, balance_reason='Saldo primera OP')[0])
    first_view = mutate(api, first_view, 'payments', {'production_id': first_id, 'amount': '1100.00', 'reference': 'Exceso primera'})
    second_view = must(api.get(f"/api/cases/{other['id']}?production_id={second_id}"))
    second_view = must(delivery(api, second_view, balance_reason='Saldo segunda OP')[0])
    second_view = mutate(api, second_view, 'payments', {'production_id': second_id, 'amount': '900.00', 'reference': 'Parcial segunda'})
    assert second_view['lifecycle'] == 'Activo'
    assert second_view['balance'] == '100.00'
    assert not completions(second_view)


def test_manual_work_and_pending_quote_block_automatic_completion(clients):
    api = clients['admin']
    case = ready(clients)
    actor_id = must(api.get('/api/auth/me'))['id']
    case = mutate(api, case, 'tasks', {'purpose': 'ATTENTION', 'owner_id': actor_id,
        'title': 'Confirmar detalle independiente',
        'due_at': (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()})
    saved = must(delivery(api, case, payment_amount='1000.00', payment_reference='Recibo')[0])
    assert saved['lifecycle'] == 'Activo'
    assert any('Confirmar detalle independiente' in text for text in saved['completion_blockers'])
    assert any(task['done_at'] is None for task in saved['tasks'] if task['purpose'] == 'ATTENTION')
    assert all(task['done_at'] for task in saved['tasks'] if task['category'] == 'PICKUP')

    quote_case = ready(clients)
    quote_case = mutate(api, quote_case, 'quotes', {'items': conversion()['items'], 'valid_until': '2099-12-31'})
    quote_case = must(delivery(api, quote_case, payment_amount='1000.00', payment_reference='Pagado')[0])
    assert quote_case['lifecycle'] == 'Activo'
    assert any('cotización' in text.lower() for text in quote_case['completion_blockers'])


def test_all_cancelled_stays_active_and_completed_case_requires_reactivation_for_correction(clients):
    api = clients['admin']
    _, case = create(api, 'Anulación total')
    case = mutate(api, case, 'convert', conversion())
    cancelled = mutate(api, case, 'production/cancel', {'reason': 'Cancelación autorizada', 'treatment': 'SIN_CARGO'})
    assert cancelled['lifecycle'] == 'Activo' and cancelled['production']['cancelled_at']

    settled = ready(clients)
    settled = must(delivery(api, settled, payment_amount='1000.00', payment_reference='Pagado')[0])
    rejected = api.post(f"/api/cases/{settled['id']}/adjustments", json={'version': settled['version'], 'key': key(),
        'production_id': settled['production']['id'], 'amount': '20.00', 'due_date': str(today()), 'reason': 'Corrección posterior'})
    assert rejected.status_code == 409
    reopened = mutate(api, settled, 'reactivate')
    adjusted = mutate(api, reopened, 'adjustments', {'amount': '20.00', 'due_date': str(today()), 'reason': 'Corrección posterior'})
    assert adjusted['lifecycle'] == 'Activo' and adjusted['balance'] == '20.00'
