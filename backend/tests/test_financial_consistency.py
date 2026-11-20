"""Financial balances, operational filters and invoice activity stay aligned."""
from datetime import timedelta
from decimal import Decimal

from app.repository import today
from test_integrated_delivery import delivery, ready
from test_workflows import conversion, create, must, mutate, release_single_order


def test_invoice_number_is_recorded_for_full_payment_and_delivery(clients):
    api = clients['admin']
    case = ready(clients)
    delivered = must(delivery(api, case, balance_reason='Pago pendiente', invoice_number='FAC-000184')[0])
    delivery_event = next(
        event for event in delivered['events']
        if event['data'].get('action') == 'delivery_collection'
    )
    assert delivery_event['data']['invoice_number'] == 'FAC-000184'
    assert 'Factura: FAC-000184' in delivery_event['body']

    restricted = must(clients['printer'].get(f"/api/cases/{case['id']}"))
    assert not any('FAC-000184' in event['body'] for event in restricted['events'])
    assert not any(event['data'].get('invoice_number') for event in restricted['events'])

    paid_case = ready(clients)
    paid_case = mutate(api, paid_case, 'payments', {
        'amount': '1000.00', 'invoice_number': 'FAC-000184',
    })
    payment_event = next(
        event for event in paid_case['events']
        if event['data'].get('action') == 'payment'
    )
    assert paid_case['balance'] == '0.00'
    assert payment_event['data']['invoice_number'] == 'FAC-000184'
    assert paid_case['ledger'][-1]['reference'] == 'FAC-000184'
    assert 'Factura: FAC-000184' in payment_event['body']

    collection_case = ready(clients)
    collection_case = must(delivery(
        api, collection_case, payment_amount='1000.00', invoice_number='FAC-000186',
    )[0])
    collection_event = next(
        event for event in collection_case['events']
        if event['data'].get('action') == 'delivery_collection'
    )
    assert collection_case['ledger'][-1]['reference'] == 'FAC-000186'
    assert collection_event['data']['invoice_number'] == 'FAC-000186'
    assert 'Factura: FAC-000186' in collection_event['body']

    paid_delivery = must(delivery(api, paid_case, invoice_number='FAC-000184')[0])
    invoice_event = next(
        event for event in paid_delivery['events']
        if event['data'].get('action') == 'invoice_registered'
    )
    assert invoice_event['data']['invoice_number'] == 'FAC-000184'
    assert 'FAC-000184' in invoice_event['body']


def test_advance_due_partial_payment_and_reversal_match_financial_filters(clients):
    api = clients['admin']
    _, case = create(api, 'Consistencia financiera')
    case = mutate(api, case, 'convert', {
        **conversion(),
        'advance_required': '200.00',
        'payment_due_date': str(today() - timedelta(days=1)),
    })
    case = release_single_order(clients, case)
    production_id = case['production']['id']

    partial_orders = must(api.get('/api/orders?view=ready&pickup=partial'))
    assert partial_orders['total'] == 1
    assert partial_orders['items'][0]['balance'] == '800.00'

    delivered = must(delivery(api, case, balance_reason='Saldo acordado')[0])
    assert delivered['balance'] == '800.00'
    assert delivered['overdue_balance'] == '800.00'
    assert delivered['payment_status'] == 'Vencido'
    assert sum((Decimal(entry['amount']) for entry in delivered['ledger']), Decimal('0')) == Decimal('800.00')

    def assert_financial_views(expected_balance, expected_overdue, status):
        detail = must(api.get(f"/api/cases/{case['id']}?production_id={production_id}"))
        assert detail['balance'] == expected_balance
        assert detail['overdue_balance'] == expected_overdue
        assert detail['payment_status'] == status
        assert sum((Decimal(entry['amount']) for entry in detail['ledger']), Decimal('0')) == Decimal(expected_balance)

        by_balance = must(api.get('/api/cases?view=balances'))
        assert by_balance['total'] == 1
        assert by_balance['items'][0]['balance'] == expected_balance
        assert by_balance['items'][0]['overdue_balance'] == expected_overdue
        assert by_balance['items'][0]['payment_status'] == status

        by_overdue = must(api.get('/api/cases?view=overdue'))
        by_payment = must(api.get(f'/api/cases?view=all&payment={status}'))
        delivered_orders = must(api.get('/api/orders?view=delivered-balances'))
        overdue_orders = must(api.get('/api/orders?view=delivered-overdue'))
        assert by_overdue['total'] == 1
        assert by_payment['total'] == 1
        assert delivered_orders['total'] == overdue_orders['total'] == 1
        assert delivered_orders['items'][0]['balance'] == expected_balance
        assert delivered_orders['items'][0]['overdue_balance'] == expected_overdue
        assert overdue_orders['items'][0]['id'] == production_id

    assert_financial_views('800.00', '800.00', 'Vencido')

    paid_part = mutate(api, delivered, 'payments', {
        'amount': '200.00', 'reference': 'Abono parcial', 'kind': 'Abono',
    })
    assert_financial_views('600.00', '600.00', 'Vencido')
    payment_id = paid_part['ledger'][-1]['id']
    reversed_payment = mutate(api, paid_part, f'payments/{payment_id}/reverse', {
        'reason': 'Transferencia devuelta',
    })
    assert_financial_views('800.00', '800.00', 'Vencido')
    assert any(event['data'].get('action') == 'payment_reversed' for event in reversed_payment['events'])

    settled = mutate(api, reversed_payment, 'payments', {
        'amount': '800.00', 'reference': 'Cobro total', 'invoice_number': 'FAC-000185',
    })
    assert settled['balance'] == settled['overdue_balance'] == '0.00'
    assert settled['payment_status'] == 'Pagado'
    assert must(api.get('/api/cases?view=balances'))['total'] == 0
    assert must(api.get('/api/cases?view=overdue'))['total'] == 0
    assert must(api.get('/api/cases?view=refunds'))['total'] == 0
    assert must(api.get('/api/cases?view=all&payment=Pagado'))['total'] == 1
    final_payment_event = next(
        event for event in settled['events']
        if event['data'].get('action') == 'payment' and event['data'].get('invoice_number')
    )
    assert final_payment_event['data']['invoice_number'] == 'FAC-000185'

    settled = mutate(api, settled, 'reactivate')
    credit = mutate(api, settled, 'payments', {
        'amount': '50.00', 'reference': 'Pago duplicado',
    })
    assert credit['balance'] == '-50.00' and credit['payment_status'] == 'A favor'
    assert must(api.get('/api/cases?view=refunds'))['total'] == 1
    refunded = mutate(api, credit, 'production/refunds', {
        'amount': '50.00', 'reference': 'Devolución de prueba',
    })
    assert refunded['balance'] == '0.00' and refunded['payment_status'] == 'Pagado'
    assert must(api.get('/api/cases?view=refunds'))['total'] == 0


def test_debt_and_credit_remain_scoped_to_different_orders(clients):
    api = clients['admin']
    _, case = create(api, 'Deuda y crédito en OP distintas')
    case = mutate(api, case, 'convert', conversion())
    debt_order_id = case['production']['id']
    credit_product = {
        **conversion()['items'][0], 'product': 'Volantes', 'quantity': '50',
    }
    case = mutate(api, case, 'convert', {
        **conversion(), 'items': [credit_product],
    })
    credit_order_id = case['production']['id']
    credited = mutate(api, case, 'payments', {
        'production_id': credit_order_id, 'amount': '600.00', 'reference': 'Exceso OP dos',
    })

    debt_order = must(api.get(f'/api/cases/{case["id"]}?production_id={debt_order_id}'))
    credit_order = must(api.get(f'/api/cases/{case["id"]}?production_id={credit_order_id}'))
    all_cases = must(api.get('/api/cases?view=all'))

    assert debt_order['balance'] == '1000.00'
    assert credit_order['balance'] == '-100.00'
    assert credited['productions'][0]['balance'] == '1000.00'
    assert credited['productions'][1]['balance'] == '-100.00'
    assert all_cases['items'][0]['balance'] == '900.00'
    assert must(api.get('/api/cases?view=balances'))['total'] == 1
    assert must(api.get('/api/cases?view=refunds'))['total'] == 1
