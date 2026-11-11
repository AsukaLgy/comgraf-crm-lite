from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import uuid
from fastapi.testclient import TestClient
from sqlalchemy import select, func, event as sqlalchemy_event
from app.main import app
from app.db import engine, SessionLocal
from app.config import settings
from app.models import Case, Production, Ledger, Item, Quote, Task, Role, User, Event, Delivery, SavedView, Session
from app.repository import today
from app.services import reopen_overdue_attention, historical_completion_candidates, regularize_historical_completions


def key(): return str(uuid.uuid4())


def must(response, status=200):
    assert response.status_code == status, response.text
    return response.json()


def create(client, subject='Consulta presencial'):
    customer = must(client.post('/api/clients', json={'name':'María Álvarez', 'company':'Gráfica Norte', 'rtn':'08011990001234', 'phones':['+504 9999-1234'], 'emails':['maria@example.test']}), 201)
    case = must(client.post('/api/cases', json={'client_id':customer['id'], 'subject':subject, 'kind':'Cotización', 'creation_context':'pool'}), 201)
    return customer, case


def mutate(client, case, path, body=None, expected=200):
    return must(client.post(f'/api/cases/{case["id"]}/{path}', json={'version':case['version'], 'key':key(), **(body or {})}), expected)


def scan_order(clients, case):
    qr = f"CGOP1:{case['production']['scan_id']}"
    return must(clients['scanner'].post('/api/scanner/scan', json={'scan_id': qr}))


def move_to_bindery(api, case, production_id=None):
    current = mutate(api, case, 'production/stage', {'production_id': production_id, 'stage': 'PRINTING'} if production_id else {'stage': 'PRINTING'})
    return mutate(api, current, 'production/stage', {'production_id': production_id, 'stage': 'WORKSHOP'} if production_id else {'stage': 'WORKSHOP'})


def release_single_order(clients, case):
    api = clients['admin']
    current = move_to_bindery(api, case, case['production']['id'])
    result = scan_order(clients, current)
    assert result['result'] == 'released'
    return must(api.get(f"/api/cases/{case['id']}?production_id={case['production']['id']}"))


def complete_delivery(api, case, production_id=None, method='Retiro en local'):
    production_id = production_id or case['production']['id']
    payload = {'version': case['version'], 'key': key(), 'production_id': production_id, 'method': method,
               'receiver': 'Cliente', 'evidence': 'Entrega completa', 'balance_reason': 'Entrega excepcional de prueba'}
    return must(api.post(f"/api/cases/{case['id']}/deliveries/complete", json=payload))


def test_creation_context_assigns_only_personal_requests(clients, accounts):
    api = clients['admin']
    customer = must(api.post('/api/clients', json={'name': 'Contextos de alta'}), 201)
    pool = must(api.post('/api/cases', json={'client_id': customer['id'], 'subject': 'Pool', 'kind': 'Solicitud', 'creation_context': 'pool'}), 201)
    personal = must(api.post('/api/cases', json={'client_id': customer['id'], 'subject': 'Personal', 'kind': 'Solicitud', 'creation_context': 'personal'}), 201)
    assert pool['owner_id'] is None
    assert personal['owner_id'] == accounts['admin']['id']
    assert api.post('/api/cases', json={'client_id': customer['id'], 'subject': 'Contexto inventado', 'kind': 'Solicitud', 'creation_context': 'unexpected'}).status_code == 422
    assert api.post('/api/cases', json={'client_id': customer['id'], 'subject': 'Propietario arbitrario', 'kind': 'Solicitud', 'creation_context': 'personal', 'owner_id': accounts['agent']['id']}).status_code == 422
    assert must(api.get('/api/cases', params={'view': 'pool'}))['total'] == 1
    assert must(api.get('/api/cases', params={'view': 'mine'}))['total'] == 1


def test_production_and_ready_queues_share_order_scope_and_count_rules(clients):
    api = clients['admin']
    _, case = create(api, 'Bandejas por OP')
    case = mutate(api, case, 'take')
    orders = []
    for _ in range(3):
        case = mutate(api, case, 'convert', conversion())
        orders.append(case['production']['id'])
    with SessionLocal.begin() as db:
        db.get(Production, orders[0]).stage = 'PRINTING'
        db.get(Production, orders[1]).stage = 'READY'
        db.get(Production, orders[2]).stage = 'READY'
        item_row = db.scalar(select(Item).where(Item.production_id == orders[2]))
        db.add(Delivery(case_id=case['id'], item_id=item_row.id, quantity=item_row.quantity,
                        delivered_at=datetime.now(timezone.utc).replace(tzinfo=None), receiver='Cliente',
                        method='Entrega (delivery)', evidence='Historial completo', actor_id=case['owner_id']))
    ready = must(api.get('/api/orders?view=ready'))
    production = must(api.get('/api/orders?view=production'))
    counts = must(api.get('/api/counts'))
    assert ready['total'] == 1 and [order['id'] for order in ready['items']] == [orders[1]]
    assert production['total'] == 1 and [order['id'] for order in production['items']] == [orders[0]]
    assert counts['ready_orders'] == counts['ready'] == 1
    assert counts['production_orders'] == 1
    assert must(api.get('/api/cases?view=balances'))['total'] == 1
    # A blocked order still in active production remains listed and is explicitly marked.
    case = mutate(api, case, 'production/block', {'production_id': orders[0], 'reason': 'Falta material'})
    production = must(api.get('/api/orders?view=production'))
    assert production['total'] == counts['production_orders'] == 1
    assert production['items'][0]['blocked_since'] and production['items'][0]['block_reason'] == 'Falta material'
    assert must(api.get('/api/orders?view=ready'))['total'] == must(api.get('/api/counts'))['ready_orders'] == 1


def test_calendar_distinguishes_schedules_debt_and_independent_attention(clients, accounts):
    api = clients['admin']
    _, case = create(api, 'Agenda con entrega y saldo')
    case = mutate(api, case, 'take')
    case = mutate(api, case, 'convert', conversion())
    order_id = case['production']['id']
    scheduled_at = datetime.now(timezone.utc) + timedelta(days=1)
    case = mutate(api, case, 'production/schedule', {'scheduled_at': scheduled_at.isoformat(),
                                                       'committed_date': str(today() + timedelta(days=3))})
    events = must(api.get('/api/calendar'))
    assert {event['type'] for event in events} == {
        'Inicio programado de producción', 'Entrega comprometida', 'Vencimiento de pago'}
    payment_due = next(event for event in events if event['type'] == 'Vencimiento de pago')
    assert payment_due['date'] == str(today() - timedelta(days=1))
    assert payment_due['date_label'] == 'Pago vence el' and payment_due['order_number'] == f'OP-{order_id:05d}'
    assert payment_due['date'].count('T') == 0
    missing = must(api.get('/api/calendar/unscheduled-collections'))
    assert [row['id'] for row in missing] == [order_id]
    case = release_single_order(clients, case)
    case = complete_delivery(api, case, order_id)
    events = must(api.get('/api/calendar'))
    assert not any(event['type'] in ('Inicio programado de producción', 'Entrega comprometida') for event in events)
    assert next(event for event in events if event['type'] == 'Vencimiento de pago')['state_label'] == 'Entregada · saldo pendiente'
    case = mutate(api, case, 'tasks', {'title': 'Llamar por una consulta separada', 'owner_id': accounts['admin']['id'],
        'due_at': (datetime.now(timezone.utc) + timedelta(days=2)).isoformat(), 'purpose': 'ATTENTION'})
    case = mutate(api, case, 'tasks', {'production_id': order_id, 'title': 'Llamar para coordinar el cobro',
        'owner_id': accounts['cashier']['id'], 'due_at': (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        'purpose': 'COLLECTION'})
    events = must(api.get('/api/calendar'))
    assert any(event['type'] == 'Seguimiento de atención' and event['action'] == 'Llamar por una consulta separada' for event in events)
    assert any(event['type'] == 'Seguimiento de cobro' and event['date_label'] == 'Cobro programado el' for event in events)
    assert must(api.get('/api/calendar/unscheduled-collections')) == []
    case = mutate(api, case, 'payments', {'production_id': order_id, 'amount': '1000.00', 'reference': 'Saldo pagado'})
    attention = next(task for task in case['tasks'] if task['title'] == 'Llamar por una consulta separada')
    collection = next(task for task in case['tasks'] if task['title'] == 'Llamar para coordinar el cobro')
    assert attention['done_at'] is None and collection['done_at'] is not None
    events = must(api.get('/api/calendar'))
    assert any(event['action'] == attention['title'] for event in events)
    assert not any(event['type'] in ('Seguimiento de cobro', 'Vencimiento de pago') for event in events)


def test_password_policy_and_service_generation_sessions(clients, accounts, monkeypatch):
    from datetime import timedelta
    import app.security as security
    from app.security import digest
    api = clients['admin']
    bad = api.post('/api/users', json={'username': 'shortpw', 'name': 'Password corto', 'password': '1234567',
                                       'roles': ['Atención'], 'capacity': 20})
    assert bad.status_code == 422
    created = must(api.post('/api/users', json={'username': 'eightpw', 'name': 'Password ocho', 'password': '12345678',
                                                'roles': ['Atención'], 'capacity': 20}), 201)
    user_client = TestClient(app, headers={'X-Comgraf-Request':'1','X-Comgraf-Contract':'5','X-Comgraf-Build':'1.4.0'})
    login = user_client.post('/api/auth/login', json={'username': 'eightpw', 'password': '12345678'})
    assert must(login)['id'] == created['id']
    assert 'max-age=31536000' in login.headers['set-cookie'].lower()
    assert user_client.post('/api/auth/password', json={'current_password':'12345678','new_password':'shorter'}).status_code == 422
    must(user_client.post('/api/auth/password', json={'current_password':'12345678','new_password':'abcdefgh'}))
    assert user_client.get('/api/auth/me').status_code == 401
    must(user_client.post('/api/auth/login', json={'username':'eightpw','password':'abcdefgh'}))
    target = must(api.get('/api/users'))
    target = next(person for person in target if person['id'] == created['id'])
    update = {'name': target['name'], 'roles': target['roles'], 'active': True, 'capacity': target['capacity'], 'password': '1234567'}
    assert api.put(f'/api/users/{created["id"]}', json=update).status_code == 422
    update['password'] = 'abcdefgh'
    must(api.put(f'/api/users/{created["id"]}', json=update))
    assert user_client.get('/api/auth/me').status_code == 401
    must(user_client.post('/api/auth/login', json={'username':'eightpw','password':'abcdefgh'}))
    token = user_client.cookies.get('comgraf_session')
    with SessionLocal.begin() as db:
        session = db.get(Session, digest(token))
        assert session.generation == app.state.session_generation
        assert session.expires_at > datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=360)
    real_clock = security.now
    monkeypatch.setattr(security, 'now', lambda: real_clock() + timedelta(hours=13))
    assert user_client.get('/api/auth/me').status_code == 200
    monkeypatch.setattr(security, 'now', real_clock)
    generation = app.state.session_generation
    assert user_client.get('/api/auth/me').status_code == 200  # workers share the service generation
    app.state.session_generation = str(uuid.uuid4())
    try:
        restarted = user_client.get('/api/auth/me')
        assert restarted.status_code == 401
        assert restarted.json()['detail'] == 'El servicio se reinició. Inicia sesión nuevamente'
    finally:
        app.state.session_generation = generation
    assert user_client.get('/api/auth/me').status_code == 200
    must(api.put(f'/api/users/{created["id"]}', json={**update, 'active': False, 'password': None}))
    assert user_client.get('/api/auth/me').status_code == 401
    user_client.close()


def test_atomic_production_request_rolls_back_and_retries_without_duplicates(clients, accounts):
    api = clients['admin']; operator = clients['printer']
    customer = must(api.post('/api/clients', json={'name': 'Alta atómica'}), 201)
    base = {**conversion(), 'client_id': customer['id'], 'subject': 'Solicitud y OP juntas', 'priority': 'Alta',
            'contact_id': None, 'version': 1, 'key': key()}
    broken = {**base, 'key': key(), 'advance_required': '999999.00'}
    before = must(api.get('/api/cases', params={'view': 'all'}))['total']
    assert operator.post('/api/production-requests', json=broken).status_code == 422
    assert must(api.get('/api/cases', params={'view': 'all'}))['total'] == before
    result = must(operator.post('/api/production-requests', json=base), 201)
    assert result['kind'] == 'Solicitud' and result['mode'] == 'Producción'
    assert result['owner_id'] is None and result['production']['stage'] == 'APPROVAL'
    replay = must(operator.post('/api/production-requests', json=base), 201)
    assert replay['id'] == result['id'] and replay['production']['id'] == result['production']['id']
    reused = {**base, 'subject': 'Contenido diferente'}
    assert operator.post('/api/production-requests', json=reused).status_code == 409
    assert operator.get('/api/clients?q=Alta').status_code == 403
    assert operator.get('/api/production-clients?q=Alta').status_code == 200


def test_complete_delivery_fills_only_historical_pending_quantity(clients):
    api = clients['admin']
    _, case = create(api, 'Saldo histórico de entrega')
    case = mutate(api, case, 'take')
    case = mutate(api, case, 'convert', conversion())
    order_id, item_id = case['production']['id'], case['items'][0]['id']
    case = release_single_order(clients, case)
    with SessionLocal.begin() as db:
        db.add(Delivery(case_id=case['id'], item_id=item_id, quantity=Decimal('40'),
                        delivered_at=datetime.now(timezone.utc).replace(tzinfo=None), receiver='Cliente',
                        method='Histórico desconocido', evidence='Movimiento parcial histórico', actor_id=case['owner_id']))
    case = must(api.get(f'/api/cases/{case["id"]}?production_id={order_id}'))
    assert case['delivery_status'] == 'Parcial' and len(case['deliveries']) == 1
    case = complete_delivery(api, case, order_id, 'Entrega (delivery)')
    assert case['delivery_status'] == 'Completa' and len(case['deliveries']) == 2
    assert sorted(row['quantity'] for row in case['deliveries']) == ['40.000', '60.000']
    assert {row['method'] for row in case['deliveries']} == {'Histórico desconocido', 'Entrega (delivery)'}


def test_concurrent_complete_delivery_creates_one_operation(clients):
    api = clients['admin']
    _, case = create(api, 'Concurrencia de entrega')
    case = mutate(api, case, 'take')
    case = mutate(api, case, 'convert', conversion())
    case = release_single_order(clients, case)
    payloads = [
        {'version': case['version'], 'key': key(), 'production_id': case['production']['id'], 'method': method,
         'receiver': 'Cliente', 'evidence': 'Concurrencia', 'balance_reason': 'Entrega excepcional de prueba'}
        for method in ('Retiro en local', 'Entrega (delivery)')
    ]
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda payload: api.post(f"/api/cases/{case['id']}/deliveries/complete", json=payload), payloads))
    assert sorted(response.status_code for response in responses) == [200, 409]
    refreshed = must(api.get(f"/api/cases/{case['id']}"))
    assert refreshed['delivery_status'] == 'Completa' and len(refreshed['deliveries']) == 1
    assert len([event for event in refreshed['events'] if event['data'].get('action') == 'delivery_completed']) == 1


def item():
    return {'product':'Tarjetas de presentación','quantity':'100','unit':'unidades','unit_price':'10.00','specs':{'width':'9.000','height':'5.000','material':'Couché 300 g','sides':'2','inks':'CMYK'}}


def conversion(owner=None):
    return {'items':[item()],'committed_date':str(today()+timedelta(days=3)), 'payment_due_date':str(today()-timedelta(days=1)), 'delivery_method':'Retiro en taller','advance_required':'100.00','payment_terms':'Contado'}


def test_order_navigation_lists_every_order_and_rejects_foreign_selection(clients):
    api = clients['admin']
    _, case = create(api, 'Tres OP visibles')
    case = mutate(api, case, 'take')
    names = ['Tarjetas de presentación', 'Volantes y flyers', 'Banners y lonas']
    orders = []
    for name in names:
        case = mutate(api, case, 'convert', {**conversion(), 'items': [{**item(), 'product': name}]})
        orders.append(case['production']['id'])
    default = must(api.get(f'/api/cases/{case["id"]}'))
    assert default['production']['id'] == orders[0]
    assert [order['product_names'] for order in default['productions']] == [[name] for name in names]
    selected = must(api.get(f'/api/cases/{case["id"]}?production_id={orders[2]}'))
    assert selected['production']['id'] == orders[2]
    assert [line['product'] for line in selected['items']] == [names[2]]
    _, other = create(api, 'Otra solicitud')
    other = mutate(api, other, 'take')
    other = mutate(api, other, 'convert', conversion())
    assert api.get(f'/api/cases/{case["id"]}?production_id={other["production"]["id"]}').status_code == 404
    assert api.get(f'/api/cases/{case["id"]}?production_id=99999999').status_code == 404


def test_multiple_orders_keep_products_stages_deliveries_and_calendar_separate(clients):
    api=clients['admin'];_,c=create(api,'Paquete para dos sucursales')
    c=mutate(api,c,'take')
    first_items=[item(),{**item(),'product':'Volantes y flyers','quantity':'500','unit_price':'2.00'}]
    first=mutate(api,c,'convert',{**conversion(),'items':first_items})
    first_id=first['production']['id']
    assert first['production']['stage']=='APPROVAL' and first['production']['created_by_id']
    assert first['production_count']==1 and len(first['items'])==2
    assert not any(e['data'].get('action')=='stage' for e in first['events'])

    second=mutate(api,first,'convert',{**conversion(),'items':[{**item(),'product':'Banners y lonas','quantity':'2','unit_price':'250.00'}]})
    second_id=second['production']['id']
    assert second_id!=first_id and second['production_count']==2 and len(second['items'])==1
    assert second['production']['stage']=='APPROVAL'
    second=mutate(api,second,'production/stage',{'production_id':second_id,'stage':'PRINTING'})
    first_view=must(api.get(f'/api/cases/{c["id"]}?production_id={first_id}'))
    second_view=must(api.get(f'/api/cases/{c["id"]}?production_id={second_id}'))
    assert first_view['production']['stage']=='APPROVAL' and len(first_view['items'])==2
    assert second_view['production']['stage']=='PRINTING' and len(second_view['items'])==1
    assert first_view['balance']=='2000.00' and second_view['balance']=='500.00'
    assert must(api.get('/api/cases',params={'view':'production','stage':'PRINTING'}))['total']==1

    first_view=move_to_bindery(api,first_view,first_id)
    result=scan_order(clients,first_view)
    assert result['result']=='confirmed_waiting'
    assert result['pending_orders'][0]['order_number']==f'OP-{second_id:05d}'
    assert result['pending_orders'][0]['reason']=='Pendiente de confirmar trabajo terminado'
    second_view=must(api.get(f'/api/cases/{c["id"]}?production_id={second_id}'))
    second_view=mutate(api,second_view,'production/stage',{'production_id':second_id,'stage':'WORKSHOP'})
    result=scan_order(clients,second_view)
    assert result['result']=='released' and set(result['released_orders'])=={f'OP-{first_id:05d}',f'OP-{second_id:05d}'}
    first_view=must(api.get(f'/api/cases/{c["id"]}?production_id={first_id}'))
    first_view=complete_delivery(api, first_view, first_id)
    second_view=must(api.get(f'/api/cases/{c["id"]}?production_id={second_id}'))
    assert first_view['delivery_status']=='Completa' and len(first_view['deliveries'])==2
    assert second_view['delivery_status']=='Pendiente' and not second_view['deliveries']
    assert second_view['production']['stage']=='READY'

    all_orders=must(api.get('/api/orders?view=production'))
    ready_orders=must(api.get('/api/orders?view=ready'))
    counts=must(api.get('/api/counts'))
    assert all_orders['total']==0 and not all_orders['items'] and all_orders['count_type']=='órdenes'
    assert ready_orders['total']==1 and {row['id'] for row in ready_orders['items']}=={second_id}
    assert ready_orders['items'][0]['pending_quantities'][0]['quantity']=='2.000'
    assert counts['production_orders']==0 and counts['ready_orders']==1
    assert must(api.get('/api/cases',params={'view':'production','stage':'PRINTING'}))['total']==0

    events=must(api.get('/api/calendar'))
    commitments=[e for e in events if e['type']=='Entrega comprometida']
    assert len(commitments)==1 and {e['production_id'] for e in commitments}=={second_id}
    assert {e['stage'] for e in commitments}=={'Listo para entregar'}


def test_binding_scans_are_idempotent_grouped_and_scanner_role_is_limited(clients, accounts):
    api=clients['admin']; scanner=clients['scanner']; _,case=create(api,'Grupo de encuadernación')
    case=mutate(api,case,'take'); first=mutate(api,case,'convert',conversion())
    first_id=first['production']['id']; first_qr='CGOP1:'+first['production']['scan_id']
    second=mutate(api,first,'convert',conversion()); second_id=second['production']['id']
    second_qr='CGOP1:'+second['production']['scan_id']
    assert first_qr!=second_qr
    assert must(api.get(f'/api/cases/{case["id"]}?production_id={first_id}'))['production']['scan_id']==first['production']['scan_id']
    first=move_to_bindery(api,must(api.get(f'/api/cases/{case["id"]}?production_id={first_id}')),first_id)
    second=must(api.get(f'/api/cases/{case["id"]}?production_id={second_id}'))
    second=mutate(api,second,'production/stage',{'production_id':second_id,'stage':'PRINTING'})
    lookup=must(scanner.get('/api/scanner/lookup',params={'qr':first_qr}))
    assert lookup['order']['order_number']==f'OP-{first_id:05d}' and lookup['order']['items'][0]['product']=='Tarjetas de presentación'
    assert not {'balance','price','ledger','payment_status','quotes','notes'} & set(lookup)
    assert scanner.get(f'/api/cases/{case["id"]}').status_code==403
    assert scanner.get('/api/users').status_code==403
    assert scanner.get('/api/orders').status_code==403
    assert scanner.post(f'/api/cases/{case["id"]}/production/stage',json={'stage':'READY'}).status_code==403
    assert clients['coordinator'].get('/api/scanner/lookup',params={'qr':first_qr}).status_code==403

    first=must(api.get(f'/api/cases/{case["id"]}?production_id={first_id}'))
    blocked=mutate(api,first,'production/block',{'production_id':first_id,'reason':'Revisión de acabado'})
    assert scanner.post('/api/scanner/scan',json={'scan_id':first_qr}).status_code==409
    first=mutate(api,blocked,'production/unblock',{'production_id':first_id,'reason':'Acabado revisado'})
    with ThreadPoolExecutor(2) as pool:
        simultaneous=list(pool.map(lambda client: client.post('/api/scanner/scan',json={'scan_id':first_qr}),
            [scanner,clients['scanner2']]))
    assert [response.status_code for response in simultaneous]==[200,200]
    results=[response.json() for response in simultaneous]
    assert {result['result'] for result in results}=={'confirmed_waiting','already_confirmed'}
    waiting=next(result for result in results if result['result']=='confirmed_waiting')
    assert waiting['pending_orders'][0]['order_number']==f'OP-{second_id:05d}'
    assert waiting['pending_orders'][0]['reason']=='Pendiente de confirmar trabajo terminado'
    repeated=must(scanner.post('/api/scanner/scan',json={'scan_id':first_qr}))
    assert repeated['result']=='already_confirmed'
    assert must(scanner.get('/api/scanner/lookup',params={'qr':second_qr}))['can_confirm']
    first_after=must(api.get(f'/api/cases/{case["id"]}?production_id={first_id}'))
    assert first_after['production']['stage']=='WORKSHOP' and first_after['production']['binding_confirmed_cycle']==0
    with ThreadPoolExecutor(2) as pool:
        final_scans=list(pool.map(lambda client: client.post('/api/scanner/scan',json={'scan_id':second_qr}),
            [scanner,clients['scanner2']]))
    assert [response.status_code for response in final_scans]==[200,200]
    assert {response.json()['result'] for response in final_scans}=={'released','already_confirmed'}
    released=next(response.json() for response in final_scans if response.json()['result']=='released')
    assert released['result']=='released' and released['released_orders']==[f'OP-{first_id:05d}',f'OP-{second_id:05d}']
    assert scanner.post('/api/scanner/scan',json={'scan_id':second_qr}).json()['result']=='already_confirmed'
    after=must(api.get(f'/api/cases/{case["id"]}?production_id={first_id}'))
    assert after['production']['stage']=='READY' and not after['deliveries'] and after['balance']=='1000.00'
    confirmations=[event for event in after['events'] if event['data'].get('action')=='binding_scan_confirmed' and event['data'].get('production_id')==first_id]
    assert len(confirmations)==1 and confirmations[0]['actor_id'] in {accounts['scanner']['id'],accounts['scanner2']['id']}
    second_after=must(api.get(f'/api/cases/{case["id"]}?production_id={second_id}'))
    assert second_after['production']['stage']=='READY'
    printing_confirmation=next(event for event in second_after['events'] if event['data'].get('action')=='binding_scan_confirmed' and event['data'].get('production_id')==second_id)
    assert printing_confirmation['data']['from']=='PRINTING' and printing_confirmation['data']['production_cycle']==0
    assert 'La etapa registrada era Impresión' in printing_confirmation['body']
    printing_release=next(event for event in second_after['events'] if event['data'].get('origin')=='binding_scan_group' and event['data'].get('production_id')==second_id and event['data'].get('action')=='stage')
    assert printing_release['data']['from']=='PRINTING' and printing_release['data']['to']=='READY'
    assert 'seconds' not in printing_release['data']
    assert len([event for event in second_after['events'] if event['data'].get('action')=='binding_group_released'])==1

    # A real reclamo starts a new bindery cycle without rewinding its sibling.
    after=mutate(api,after,'production/stage',{'production_id':first_id,'stage':'WORKSHOP','reason':'Reclamo: corregir acabado'})
    assert after['production']['workflow_cycle']==1 and after['production']['binding_confirmed_at'] is None
    scan_again=must(scanner.post('/api/scanner/scan',json={'scan_id':first_qr}))
    assert scan_again['result']=='released'
    sibling=must(api.get(f'/api/cases/{case["id"]}?production_id={second_id}'))
    assert sibling['production']['stage']=='READY'
    after_reclaim=must(api.get(f'/api/cases/{case["id"]}?production_id={first_id}'))
    confirmations=[event for event in after_reclaim['events'] if event['data'].get('action')=='binding_scan_confirmed' and event['data'].get('production_id')==first_id]
    assert len(confirmations)==2


def test_single_printing_order_can_be_confirmed_without_bindery_transition(clients):
    api=clients['admin']; scanner=clients['scanner']
    _,case=create(api,'Impresión terminada físicamente')
    case=mutate(api,case,'take')
    case=mutate(api,case,'convert',conversion())
    production_id=case['production']['id']
    qr='CGOP1:'+case['production']['scan_id']
    assert scanner.post('/api/scanner/scan',json={'scan_id':qr}).status_code==409
    assert scanner.post('/api/scanner/scan',json={'scan_id':'QR-inválido'}).status_code==422
    case=mutate(api,case,'production/stage',{'production_id':production_id,'stage':'PRINTING'})
    lookup=must(scanner.get('/api/scanner/lookup',params={'qr':qr}))
    assert lookup['can_confirm'] and lookup['order']['stage']=='PRINTING'
    result=must(scanner.post('/api/scanner/scan',json={'scan_id':qr}))
    assert result['result']=='released' and result['released_orders']==[f'OP-{production_id:05d}']
    assert must(scanner.post('/api/scanner/scan',json={'scan_id':qr}))['result']=='already_confirmed'
    after=must(api.get(f'/api/cases/{case["id"]}?production_id={production_id}'))
    assert after['production']['stage']=='READY' and not after['deliveries']
    stages=[event['data'] for event in after['events'] if event['data'].get('action')=='stage' and event['data'].get('production_id')==production_id]
    assert any(event.get('from')=='PRINTING' and event.get('to')=='READY' for event in stages)
    assert not any(event.get('from')=='PRINTING' and event.get('to')=='WORKSHOP' for event in stages)
    assert len([event for event in after['events'] if event['data'].get('action')=='binding_scan_confirmed'])==1


def test_manual_finish_from_printing_and_workshop_has_same_cycle_as_qr(clients, accounts):
    api=clients['admin']; printer=clients['printer']; scanner=clients['scanner']
    _,case=create(api,'Confirmación manual de dos OP')
    case=mutate(api,case,'take'); first=mutate(api,case,'convert',conversion())
    first_id=first['production']['id']; first_qr='CGOP1:'+first['production']['scan_id']
    second=mutate(api,first,'convert',conversion()); second_id=second['production']['id']
    second_qr='CGOP1:'+second['production']['scan_id']
    url=f'/api/cases/{case["id"]}/production/confirm-finished'
    assert api.post(url,json={'production_id':first_id}).status_code==409
    assert clients['agent'].post(url,json={'production_id':first_id}).status_code==403
    assert clients['cashier'].post(url,json={'production_id':first_id}).status_code==403
    assert scanner.post(url,json={'production_id':first_id}).status_code==403
    first=mutate(api,must(api.get(f'/api/cases/{case["id"]}?production_id={first_id}')),'production/stage',{'production_id':first_id,'stage':'PRINTING'})
    second=move_to_bindery(api,must(api.get(f'/api/cases/{case["id"]}?production_id={second_id}')),second_id)
    first=must(api.get(f'/api/cases/{case["id"]}?production_id={first_id}'))
    first=mutate(api,first,'production/block',{'production_id':first_id,'reason':'Revisar acabado'})
    assert printer.post(url,json={'production_id':first_id}).status_code==409
    first=mutate(api,first,'production/unblock',{'production_id':first_id,'reason':'Acabado revisado'})
    waiting=must(printer.post(url,json={'production_id':first_id}))
    assert waiting['result']=='confirmed_waiting' and waiting['message']=='Trabajo terminado confirmado. Pendiente de completar las demás órdenes.'
    assert [row['order_number'] for row in waiting['pending_orders']]==[f'OP-{second_id:05d}']
    assert waiting['order']['order_number']==f'OP-{first_id:05d}' and waiting['order']['confirmed']
    summary=must(api.get(f'/api/cases/{case["id"]}?production_id={first_id}'))['productions']
    confirmed_order=next(order for order in summary if order['id']==first_id)
    pending_order=next(order for order in summary if order['id']==second_id)
    assert confirmed_order['binding_confirmed_at'] and confirmed_order['binding_confirmed_cycle']==confirmed_order['workflow_cycle']
    assert pending_order['binding_confirmed_at'] is None and pending_order['order_number']==f'OP-{second_id:05d}'
    assert must(scanner.get('/api/scanner/lookup',params={'qr':first_qr}))['order']['confirmed']
    assert must(scanner.post('/api/scanner/scan',json={'scan_id':first_qr}))['result']=='already_confirmed'
    assert must(api.post(url,json={'production_id':first_id}))['result']=='already_confirmed'
    released=must(scanner.post('/api/scanner/scan',json={'scan_id':second_qr}))
    assert released['result']=='released' and set(released['released_orders'])=={f'OP-{first_id:05d}',f'OP-{second_id:05d}'}
    assert must(api.post(url,json={'production_id':second_id}))['result']=='already_confirmed'
    after=must(api.get(f'/api/cases/{case["id"]}?production_id={first_id}'))
    assert after['production']['stage']=='READY' and after['lifecycle']=='Activo' and not after['deliveries']
    manual=[e for e in after['events'] if e['data'].get('action')=='work_finished_confirmed']
    scanned=[e for e in after['events'] if e['data'].get('action')=='binding_scan_confirmed']
    releases=[e for e in after['events'] if e['data'].get('action')=='binding_group_released']
    assert len(manual)==len(scanned)==len(releases)==1
    assert manual[0]['actor_id']==accounts['printer']['id'] and manual[0]['data']['from']=='PRINTING'
    assert manual[0]['data']['origin']=='crm_manual' and manual[0]['data']['production_cycle']==0
    assert f'OP-{first_id:05d}' in manual[0]['body']
    assert scanned[0]['data']['from']=='WORKSHOP' and scanned[0]['data']['origin']=='scanner'
    stage=[e for e in after['events'] if e['data'].get('action')=='stage' and e['data'].get('production_id')==first_id and e['data'].get('to')=='READY']
    assert len(stage)==1 and stage[0]['data']['from']=='PRINTING'
    assert not any(e['data'].get('from')=='PRINTING' and e['data'].get('to')=='WORKSHOP' and e['data'].get('production_id')==first_id for e in after['events'])


def test_manual_finish_from_workshop_and_cancelled_order_is_denied(clients):
    api=clients['admin']
    _,case=create(api,'Trabajo terminado en encuadernación')
    case=mutate(api,case,'take'); case=mutate(api,case,'convert',conversion())
    order_id=case['production']['id']
    case=move_to_bindery(api,case,order_id)
    result=must(api.post(f'/api/cases/{case["id"]}/production/confirm-finished',json={'production_id':order_id}))
    assert result['result']=='released'
    after=must(api.get(f'/api/cases/{case["id"]}?production_id={order_id}'))
    assert after['production']['stage']=='READY'
    manual=next(e for e in after['events'] if e['data'].get('action')=='work_finished_confirmed')
    assert manual['data']['from']=='WORKSHOP'
    assert not any(e['data'].get('origin')=='crm_manual_group' and e['data'].get('from')=='PRINTING' for e in after['events'])

    _,cancelled=create(api,'Orden anulada sin confirmación')
    cancelled=mutate(api,cancelled,'take'); cancelled=mutate(api,cancelled,'convert',conversion())
    cancelled=mutate(api,cancelled,'production/stage',{'production_id':cancelled['production']['id'],'stage':'PRINTING'})
    cancelled=mutate(api,cancelled,'production/cancel',{'production_id':cancelled['production']['id'],
        'reason':'Cliente anuló la orden','treatment':'SIN_CARGO'})
    assert api.post(f'/api/cases/{cancelled["id"]}/production/confirm-finished',json={'production_id':cancelled['production']['id']}).status_code==409


def test_manual_finish_partial_release_and_reclaim_cycle(clients):
    api=clients['admin']; scanner=clients['scanner']; coordinator=clients['coordinator']
    _,case=create(api,'Liberación parcial tras confirmación manual')
    case=mutate(api,case,'take'); first=mutate(api,case,'convert',conversion())
    first_id=first['production']['id']; qr='CGOP1:'+first['production']['scan_id']
    mutate(api,first,'convert',conversion())
    first=mutate(api,must(api.get(f'/api/cases/{case["id"]}?production_id={first_id}')),'production/stage',{'production_id':first_id,'stage':'PRINTING'})
    url=f'/api/cases/{case["id"]}/production/confirm-finished'
    waiting=must(api.post(url,json={'production_id':first_id}))
    assert waiting['result']=='confirmed_waiting' and waiting['can_request_partial']
    request=must(scanner.post('/api/scanner/exceptions',json={'scan_id':qr,'comment':'Entrega anticipada solicitada','request_key':key()}),201)
    approved=must(coordinator.post(f'/api/scanner/exceptions/{request["id"]}/decision',json={'approve':True,'comment':'Autorizado para retirar','request_key':key()}))
    assert approved['status']=='Aprobada'
    first=must(api.get(f'/api/cases/{case["id"]}?production_id={first_id}'))
    assert first['production']['stage']=='READY'
    assert must(api.post(url,json={'production_id':first_id}))['result']=='already_confirmed'
    first=mutate(api,first,'production/stage',{'production_id':first_id,'stage':'PRINTING','reason':'Reclamo de cliente'})
    assert first['production']['workflow_cycle']==1 and first['production']['binding_confirmed_at'] is None
    again=must(api.post(url,json={'production_id':first_id}))
    assert again['result']=='confirmed_waiting' and again['order']['confirmed']
    assert must(scanner.post('/api/scanner/scan',json={'scan_id':qr}))['result']=='already_confirmed'
    after=must(api.get(f'/api/cases/{case["id"]}?production_id={first_id}'))
    confirms=[e for e in after['events'] if e['data'].get('action')=='work_finished_confirmed']
    assert len(confirms)==2 and {e['data']['production_cycle'] for e in confirms}=={0,1}


def test_simultaneous_manual_and_qr_confirm_only_once(clients):
    api=clients['admin']; printer=clients['printer']; scanner=clients['scanner']
    _,case=create(api,'Confirmación simultánea')
    case=mutate(api,case,'take'); case=mutate(api,case,'convert',conversion())
    production_id=case['production']['id']; qr='CGOP1:'+case['production']['scan_id']
    case=mutate(api,case,'production/stage',{'production_id':production_id,'stage':'PRINTING'})
    url=f'/api/cases/{case["id"]}/production/confirm-finished'
    with ThreadPoolExecutor(2) as pool:
        manual=pool.submit(printer.post,url,json={'production_id':production_id})
        scanned=pool.submit(scanner.post,'/api/scanner/scan',json={'scan_id':qr})
        results=[manual.result(),scanned.result()]
    assert [response.status_code for response in results]==[200,200]
    assert {response.json()['result'] for response in results}=={'released','already_confirmed'}
    after=must(api.get(f'/api/cases/{case["id"]}?production_id={production_id}'))
    assert after['production']['stage']=='READY'
    assert len([e for e in after['events'] if e['data'].get('action') in {'work_finished_confirmed','binding_scan_confirmed'}])==1
    assert len([e for e in after['events'] if e['data'].get('action')=='binding_group_released'])==1
    assert len([e for e in after['events'] if e['data'].get('action')=='pickup_followup_created'])==1


def test_partial_release_requires_real_authorization_and_revalidates_cycle(clients):
    api=clients['admin']; scanner=clients['scanner']; coordinator=clients['coordinator']
    _,case=create(api,'Excepción de liberación')
    case=mutate(api,case,'take'); first=mutate(api,case,'convert',conversion()); first_id=first['production']['id']
    second=mutate(api,first,'convert',conversion())
    first=mutate(api,must(api.get(f'/api/cases/{case["id"]}?production_id={first_id}')),'production/stage',{'production_id':first_id,'stage':'PRINTING'})
    scan_id='CGOP1:'+first['production']['scan_id']
    waiting=must(scanner.post('/api/scanner/scan',json={'scan_id':scan_id}))
    assert waiting['result']=='confirmed_waiting'
    assert waiting['can_request_partial']
    assert scanner.post('/api/scanner/exceptions',json={'scan_id':scan_id,'comment':' ','request_key':key()}).status_code==422
    request_body={'scan_id':scan_id,'comment':'El cliente retira esta orden hoy','request_key':key()}
    request=must(scanner.post('/api/scanner/exceptions',json=request_body),201)
    replay=must(scanner.post('/api/scanner/exceptions',json=request_body),201)
    assert replay['id']==request['id'] and coordinator.get('/api/scanner/exceptions').status_code==200
    assert scanner.get('/api/scanner/exceptions').status_code==403
    assert scanner.post(f'/api/scanner/exceptions/{request["id"]}/decision',json={'approve':True,'comment':'Autorizo la salida','request_key':key()}).status_code==403
    approvals=must(coordinator.get('/api/scanner/exceptions'))
    assert approvals[0]['request_comment']==request_body['comment'] and approvals[0]['pending_orders']
    decision={'approve':True,'comment':'Coordinación confirmó la excepción operativa','request_key':key()}
    approved=must(coordinator.post(f'/api/scanner/exceptions/{request["id"]}/decision',json=decision))
    assert approved['status']=='Aprobada'
    repeated=must(coordinator.post(f'/api/scanner/exceptions/{request["id"]}/decision',json=decision))
    assert repeated['status']=='Aprobada'
    order=must(api.get(f'/api/cases/{case["id"]}?production_id={first_id}'))
    other=must(api.get(f'/api/cases/{case["id"]}?production_id={second["production"]["id"]}'))
    assert order['production']['stage']=='READY' and other['production']['stage']=='APPROVAL'
    partial_stage=next(event for event in order['events'] if event['data'].get('origin')=='partial_release' and event['data'].get('action')=='stage')
    assert partial_stage['data']['from']=='PRINTING' and partial_stage['data']['to']=='READY'
    assert order['lifecycle']=='Activo' and not order['deliveries'] and order['balance']=='1000.00'
    scanner_result=must(scanner.get(f'/api/scanner/exceptions/{request["id"]}'))
    assert scanner_result['status']=='Aprobada' and scanner_result['order']['stage']=='READY'

    # A pending approval tied to an old cycle cannot release a reworked order.
    _,stale_case=create(api,'Excepción invalidada por reclamo')
    stale_case=mutate(api,stale_case,'take'); first=mutate(api,stale_case,'convert',conversion()); stale_id=first['production']['id']
    second=mutate(api,first,'convert',conversion())
    first=move_to_bindery(api,must(api.get(f'/api/cases/{stale_case["id"]}?production_id={stale_id}')),stale_id)
    stale_qr='CGOP1:'+first['production']['scan_id']
    must(scanner.post('/api/scanner/scan',json={'scan_id':stale_qr}))
    stale_request=must(scanner.post('/api/scanner/exceptions',json={'scan_id':stale_qr,'comment':'Liberación pedida antes del reclamo','request_key':key()}),201)
    first=must(api.get(f'/api/cases/{stale_case["id"]}?production_id={stale_id}'))
    first=mutate(api,first,'production/stage',{'production_id':stale_id,'stage':'PRINTING','reason':'Corrección por reclamo'})
    first=mutate(api,first,'production/stage',{'production_id':stale_id,'stage':'WORKSHOP'})
    invalidated=must(coordinator.post(f'/api/scanner/exceptions/{stale_request["id"]}/decision',json={'approve':True,'comment':'Revisada por coordinación','request_key':key()}))
    assert invalidated['status']=='Invalidada'
    first=must(api.get(f'/api/cases/{stale_case["id"]}?production_id={stale_id}'))
    assert first['production']['stage']=='WORKSHOP' and first['production']['workflow_cycle']==1


def test_manual_ready_transition_is_forbidden(clients):
    api=clients['admin']; _,case=create(api,'Transición manual controlada')
    case=mutate(api,case,'take'); case=mutate(api,case,'convert',conversion())
    case=move_to_bindery(api,case,case['production']['id'])
    mutate(api,case,'production/stage',{'stage':'READY'},409)
    current=must(api.get(f'/api/cases/{case["id"]}'))
    assert current['production']['stage']=='WORKSHOP'


def test_attention_history_search_and_drafts(clients):
    api=clients['admin']
    customer,c=create(api)
    original=c['id']
    c=mutate(api,c,'take')
    c=mutate(api,c,'events',{'kind':'Nota interna','channel':'Nota','body':'Consulta de precios sin fabricación'})
    assert c['first_response_at'] is None
    must(api.put(f'/api/cases/{original}/drafts/Nota',json={'body':'Borrador Nota','version':0}))
    c=mutate(api,c,'tasks',{'title':'Confirmar información','owner_id':c['owner_id'],'due_at':(datetime.now(timezone.utc)-timedelta(hours=1)).isoformat()})
    assert must(api.get('/api/cases?view=action'))['total']==1
    c=mutate(api,c,f'tasks/{c["tasks"][0]["id"]}/complete')
    c=mutate(api,c,'attention',{'status':'Cerrado'})
    assert c['mode']=='Atención' and c['production'] is None
    assert len(c['drafts'])==1
    for term in ['maria alvarez','0801199000123','50499991234','maria@example.test',c['number']]:
        result=must(api.get('/api/cases',params={'view':'all','q':term}))
        assert result['total']==1
    assert must(api.get('/api/clients/'+str(customer['id'])))['cases'][0]['id']==original
    with SessionLocal.begin() as db:
        db.add(Event(case_id=original,actor_id=c['owner_id'],kind='Historical',channel='Llamada',body='Legacy phone record',data={}))
        db.add(Event(case_id=original,actor_id=c['owner_id'],kind='Historical',channel='Visita',body='Legacy visit record',data={}))
    historical=must(api.get(f'/api/cases/{original}'))
    assert {event['channel'] for event in historical['events'] if event['body'].startswith('Legacy ')}=={'Llamada','Visita'}
    assert must(api.get('/api/cases?view=history'))['total']==1
    assert must(api.get('/api/counts'))['history']==1
    engine.dispose()
    assert must(api.get(f'/api/cases/{original}'))['status']=='Cerrado'


def test_attention_can_open_and_close_without_reason_and_legacy_message_flag_does_not_block(clients):
    api=clients['admin'];_,c=create(api,'Atención independiente del trabajo')
    c=mutate(api,c,'take')
    with SessionLocal.begin() as db:
        db.get(Case,c['id']).pending_message = True
    c=must(api.get(f'/api/cases/{c["id"]}'))
    assert must(api.get('/api/cases?view=action'))['total']==1
    c=mutate(api,c,'attention',{'status':'Cerrado'})
    assert c['status']=='Cerrado' and c['production'] is None and c['close_reason'] is None and c['pending_message'] is True
    assert must(api.get('/api/cases?view=action'))['total']==0
    c=mutate(api,c,'events',{'kind':'Nota interna','channel':'Nota','body':'Nota guardada después del cierre'})
    assert c['status']=='Cerrado' and must(api.get('/api/cases?view=action'))['total']==0
    c=mutate(api,c,'attention',{'status':'Abierto'})
    assert c['status']=='Abierto' and must(api.get('/api/cases?view=action'))['total']==1
    c=mutate(api,c,'attention',{'status':'Cerrado'})
    assert c['status']=='Cerrado' and c['pending_message'] is True


def test_unassigned_pool_ignores_filters_and_take_persists_in_personal_views(clients,accounts):
    api=clients['admin'];_,c=create(api,'Sin asignar y cerrada')
    c=mutate(api,c,'attention',{'status':'Cerrado'})
    query={'view':'pool','status':'Abierto','mode':'Producción','priority':'Urgente','stage':'WORKSHOP','payment':'Pagado','due':'2000-01-01','sort':'oldest'}
    pool=must(api.get('/api/cases',params=query))
    assert pool['total']==1 and pool['items'][0]['id']==c['id']
    assert must(api.get('/api/counts'))['pool']==1
    with SessionLocal.begin() as db:
        db.add(SavedView(user_id=accounts['admin']['id'],name='Pool heredado',filters=query))
    assert must(api.get('/api/views'))[0]['filters']=={'view':'pool','sort':'oldest'}
    c=mutate(api,c,'take')
    assert c['owner_id']==accounts['admin']['id'] and c['status']=='Cerrado'
    assert must(api.get('/api/cases?view=pool'))['total']==0
    assert must(api.get('/api/cases?view=mine'))['total']==1
    assert must(api.get('/api/cases?view=mine-action'))['total']==0
    assert must(api.get('/api/counts'))['mine']==1 and must(api.get('/api/counts'))['pool']==0
    second_session=TestClient(app,headers={'X-Comgraf-Request':'1','X-Comgraf-Contract':'5','X-Comgraf-Build':'1.4.0'})
    must(second_session.post('/api/auth/login',json={'username':'admin','password':accounts['admin']['password']}))
    persisted=must(second_session.get('/api/cases?view=mine'))
    assert persisted['total']==1 and persisted['items'][0]['owner_id']==accounts['admin']['id']


def test_actionable_views_require_active_and_ignore_saved_status_and_lifecycle(clients):
    api=clients['admin'];_,c=create(api,'Seguimiento aunque atención cerrada')
    c=mutate(api,c,'take')
    future=(datetime.now(timezone.utc)+timedelta(days=3)).isoformat()
    c=mutate(api,c,'tasks',{'title':'Revisar con el cliente','owner_id':c['owner_id'],'due_at':future})
    c=mutate(api,c,'attention',{'status':'Cerrado'})
    assert must(api.get('/api/cases?view=mine&lifecycle=Completado'))['total']==1
    assert must(api.get('/api/cases?view=mine-action&status=Cerrado&lifecycle=Completado'))['total']==0
    with SessionLocal.begin() as db:
        task=db.scalar(select(Task).where(Task.case_id==c['id']))
        task.due_at=datetime.now(timezone.utc).replace(tzinfo=None)-timedelta(minutes=1)
    assert must(api.get('/api/cases?view=mine-action&status=Cerrado&lifecycle=Completado'))['total']==1
    assert must(api.get('/api/cases?view=action&status=Cerrado&lifecycle=Completado'))['total']==1
    assert must(api.get('/api/cases?view=mine-action'))['items'][0]['requires_action'] is True


def test_reassignment_moves_active_work_between_personal_views(clients,accounts):
    admin=clients['admin']; agent=clients['agent']; agent2=clients['agent2']
    _,c=create(admin,'Solicitud para reasignar')
    c=mutate(agent,c,'take')
    c=mutate(admin,c,'convert',conversion())
    changed=must(admin.post(f'/api/cases/{c["id"]}/assign',json={'version':c['version'],'key':key(),'owner_id':accounts['agent2']['id']}))
    assert changed['owner_id']==accounts['agent2']['id'] and changed['status']=='Abierto' and changed['lifecycle']=='Activo'
    assert changed['production']['stage']=='APPROVAL'
    assert must(agent.get('/api/cases?view=mine'))['total']==0
    mine2=must(agent2.get('/api/cases?view=mine'))
    assert mine2['total']==1 and mine2['items'][0]['id']==c['id']
    assert must(agent2.get('/api/cases?view=mine-action'))['total']==1


def test_manual_production_completion_waits_for_delivery_payment_and_tasks(clients,accounts):
    api=clients['admin'];_,c=create(api,'Completar producción resuelta')
    c=mutate(api,c,'take');c=mutate(api,c,'convert',conversion())
    c=release_single_order(clients,c)
    c=mutate(api,c,'attention',{'status':'Cerrado'})
    c=mutate(api,c,'payments',{'amount':'1000.00','reference':'Pago completo'})
    assert c['lifecycle']=='Activo' and c['status']=='Cerrado'
    assert must(api.get('/api/cases?view=finalized'))['total']==0
    future=(datetime.now(timezone.utc)+timedelta(days=5)).isoformat()
    c=mutate(api,c,'tasks',{'title':'Confirmar entrega final','owner_id':c['owner_id'],'due_at':future})
    c=complete_delivery(api, c, method='Retiro en local')
    assert c['lifecycle']=='Activo' and c['delivery_status']=='Completa'
    assert must(api.get('/api/cases?view=balances'))['total']==0
    assert must(api.get('/api/cases?view=mine'))['total']==1
    task=next(t for t in c['tasks'] if t['title']=='Confirmar entrega final')
    c=mutate(api,c,f'tasks/{task["id"]}/complete')
    assert c['lifecycle']=='Activo'
    c=mutate(api,c,'complete')
    assert c['lifecycle']=='Completado' and c['status']=='Cerrado' and c['owner_id']==accounts['admin']['id']
    completed=[e for e in c['events'] if e['data'].get('action')=='case_completed']
    assert len(completed)==1 and completed[0]['data']['origin']=='manual'
    assert must(api.get('/api/cases?view=mine'))['total']==0
    assert must(api.get('/api/cases?view=finalized'))['total']==1
    c=mutate(api,c,'reactivate')
    assert c['lifecycle']=='Activo'
    assert must(api.get(f'/api/cases/{c["id"]}'))['lifecycle']=='Activo'
    c=mutate(api,c,'attention',{'status':'Cerrado'})
    assert c['lifecycle']=='Activo'
    c=mutate(api,c,'complete')
    assert c['lifecycle']=='Completado'
    assert len([e for e in c['events'] if e['data'].get('action')=='case_completed'])==2


def test_delivered_production_with_unpaid_balance_is_not_completed(clients):
    api=clients['admin'];_,c=create(api,'Entrega con saldo pendiente')
    c=mutate(api,c,'take');c=mutate(api,c,'convert',conversion())
    c=release_single_order(clients,c)
    c=complete_delivery(api, c)
    assert c['delivery_status']=='Completa' and c['balance']=='1000.00' and c['lifecycle']=='Activo'
    assert must(api.get('/api/cases?view=balances'))['total']==1
    assert must(api.get('/api/cases?view=finalized'))['total']==0


def test_historical_completion_regularization_preview_and_idempotence(clients):
    api=clients['admin'];_,c=create(api,'Regularización histórica')
    c=mutate(api,c,'take');c=mutate(api,c,'convert',conversion())
    with SessionLocal.begin() as db:
        case=db.get(Case,c['id']); production=db.get(Production,c['production']['id'])
        production.stage='READY'
        db.add(Delivery(case_id=case.id,item_id=db.scalar(select(Item.id).where(Item.case_id==case.id)),quantity=100,delivered_at=datetime.now(timezone.utc).replace(tzinfo=None),receiver='Cliente',method='Retiro',evidence='Histórico de entrega',actor_id=case.owner_id))
        db.add(Ledger(case_id=case.id,production_id=production.id,kind='Abono',amount=Decimal('-1000.00'),currency='HNL',reference='Histórico de pago',actor_id=case.owner_id))
        case.status='Abierto'
    with SessionLocal() as db:
        candidates=historical_completion_candidates(db)
        assert [case.id for case in candidates]==[c['id']]
        assert db.get(Case,c['id']).lifecycle=='Activo'
    with SessionLocal.begin() as db:
        run_id,changed=regularize_historical_completions(db,'test-regularization')
        assert run_id=='test-regularization' and [case.id for case in changed]==[c['id']]
    with SessionLocal.begin() as db:
        case=db.get(Case,c['id']);events=[e for e in db.scalars(select(Event).where(Event.case_id==c['id'])).all() if e.data.get('action')=='case_completed']
        assert case.lifecycle=='Completado' and case.completed_by_id is None
        assert len(events)==1 and events[0].data['origin']=='historical_regularization'
        assert events[0].body=='Solicitud regularizada durante la actualización'
        assert events[0].data['regularization_run']=='test-regularization'
        assert db.scalar(select(func.sum(Ledger.amount)).where(Ledger.case_id==c['id']))==0
        assert db.scalar(select(func.sum(Delivery.quantity)).where(Delivery.case_id==c['id']))==100
        assert regularize_historical_completions(db,'test-regularization')[1]==[]


def test_future_followup_close_then_due_recovery_and_reschedule(clients):
    api=clients['admin'];_,c=create(api,'Seguimiento independiente')
    c=mutate(api,c,'take')
    due=(datetime.now(timezone.utc)+timedelta(days=1)).isoformat()
    c=mutate(api,c,'tasks',{'title':'Llamar después','owner_id':c['owner_id'],'due_at':due})
    task=c['tasks'][0]
    c=mutate(api,c,'attention',{'status':'Cerrado'})
    assert c['status']=='Cerrado' and c['tasks'][0]['done_at'] is None
    assert must(api.get('/api/cases?view=action'))['total']==0
    with SessionLocal.begin() as db:
        db.get(Task,task['id']).due_at=datetime.now(timezone.utc).replace(tzinfo=None)-timedelta(minutes=1)
    with SessionLocal.begin() as db:
        assert reopen_overdue_attention(db)==1
    c=must(api.get(f'/api/cases/{c["id"]}'))
    assert c['status']=='Abierto' and must(api.get('/api/cases?view=action'))['total']==1
    with SessionLocal.begin() as db:
        assert reopen_overdue_attention(db)==0
    automatic=[e for e in c['events'] if e['data'].get('origin')=='automatic']
    assert len(automatic)==1
    new_due=datetime.now(timezone.utc)+timedelta(days=2)
    payload={'version':c['version'],'key':key(),'due_at':new_due.isoformat()}
    c=must(api.put(f'/api/cases/{c["id"]}/tasks/{task["id"]}',json=payload))
    assert c['tasks'][0]['done_at'] is None and c['tasks'][0]['due_at'].startswith((new_due.date()).isoformat())


def test_personal_inboxes_include_closed_requests_and_count_only_due_followups(clients):
    api=clients['admin']
    _,actionable=create(api,'Solicitud inmediata')
    actionable=mutate(api,actionable,'take')

    _,waiting=create(api,'Solicitud en espera')
    waiting=mutate(api,waiting,'take')
    future=(datetime.now(timezone.utc)+timedelta(days=7)).isoformat()
    waiting=mutate(api,waiting,'tasks',{'title':'Contactar la próxima semana','owner_id':waiting['owner_id'],'due_at':future})
    task_id=waiting['tasks'][0]['id']
    waiting=mutate(api,waiting,'attention',{'status':'Cerrado'})

    mine=must(api.get('/api/cases?view=mine'))
    mine_action=must(api.get('/api/cases?view=mine-action'))
    assert mine['total']==2 and {row['id'] for row in mine['items']}=={actionable['id'],waiting['id']}
    assert mine_action['total']==1 and mine_action['items'][0]['id']==actionable['id']
    assert must(api.get('/api/cases?view=mine&status=Cerrado'))['total']==1
    assert must(api.get('/api/cases?view=mine-action&status=Cerrado'))['total']==1
    counts=must(api.get('/api/counts'))
    assert counts['mine']==2 and counts['mine-action']==1

    saved=must(api.post('/api/views',json={'name':'Requieren mi acción','filters':{'view':'mine-action','status':'Cerrado'}}))
    assert saved['filters']=={'view':'mine-action'}

    with SessionLocal.begin() as db:
        db.get(Task,task_id).due_at=datetime.now(timezone.utc).replace(tzinfo=None)-timedelta(minutes=1)
    mine_action=must(api.get('/api/cases?view=mine-action'))
    assert mine_action['total']==2 and {row['id'] for row in mine_action['items']}=={actionable['id'],waiting['id']}
    assert must(api.get('/api/counts'))['mine-action']==2


def test_explicit_completion_reactivation_and_future_task_blockers(clients):
    api=clients['admin'];_,c=create(api,'Resolved consultation')
    c=mutate(api,c,'take')
    c=mutate(api,c,'attention',{'status':'Cerrado'})
    assert c['lifecycle']=='Activo' and must(api.get('/api/cases?view=mine'))['total']==1
    due=(datetime.now(timezone.utc)+timedelta(days=8)).isoformat()
    c=mutate(api,c,'tasks',{'title':'Confirm delivery','owner_id':c['owner_id'],'due_at':due})
    blocked=api.post(f'/api/cases/{c["id"]}/complete',json={'version':c['version'],'key':key()})
    assert blocked.status_code==409 and 'seguimiento pendiente' in blocked.json()['detail']
    assert must(api.get(f'/api/cases/{c["id"]}'))['tasks'][0]['done_at'] is None
    c=mutate(api,c,f'tasks/{c["tasks"][0]["id"]}/complete')
    completion={'version':c['version'],'key':key()}
    c=must(api.post(f'/api/cases/{c["id"]}/complete',json=completion))
    replay=must(api.post(f'/api/cases/{c["id"]}/complete',json=completion))
    assert replay['lifecycle']=='Completado'
    assert must(api.get('/api/cases?view=mine'))['total']==0
    assert must(api.get('/api/cases?view=finalized'))['total']==1
    assert c['status']=='Cerrado' and c['completed_by_id']
    c=mutate(api,c,'reactivate')
    assert c['lifecycle']=='Activo' and c['status']=='Abierto' and c['completed_at'] is None
    assert len([e for e in c['events'] if e['data'].get('action') in ('case_completed','case_reactivated')])==2


def test_completion_reports_live_production_and_financial_blockers(clients):
    api=clients['admin'];_,c=create(api,'Production still pending')
    c=mutate(api,c,'take');c=mutate(api,c,'convert',conversion())
    blocked=api.post(f'/api/cases/{c["id"]}/complete',json={'version':c['version'],'key':key()})
    assert blocked.status_code==409 and 'Falta entregar 100' in blocked.json()['detail'] and '1,000.00 por cobrar' in blocked.json()['detail']
    current=must(api.get(f'/api/cases/{c["id"]}'))
    assert current['lifecycle']=='Activo' and current['production']['stage']=='APPROVAL' and current['balance']=='1000.00'


def test_weekly_pickup_followup_partial_and_full_delivery(clients):
    api=clients['admin'];_,c=create(api,'Waiting for pickup')
    c=mutate(api,c,'take');c=mutate(api,c,'convert',conversion())
    c=release_single_order(clients,c)
    pickup=[task for task in c['tasks'] if task['category']=='PICKUP']
    assert len(pickup)==1 and pickup[0]['owner_id']==c['owner_id']
    assert datetime.fromisoformat(pickup[0]['due_at'].replace('Z','+00:00')).date() >= (datetime.now(timezone.utc)+timedelta(days=6)).date()
    assert api.get('/api/cases?view=ready').json()['total']==1
    c=mutate(api,c,f'tasks/{pickup[0]["id"]}/complete',{'note':'Customer will pick up Friday','schedule_next_pickup':True})
    next_task=next(task for task in c['tasks'] if task['category']=='PICKUP' and task['done_at'] is None)
    assert datetime.fromisoformat(next_task['due_at'].replace('Z','+00:00')).date() >= (datetime.now(timezone.utc)+timedelta(days=6)).date()
    c=complete_delivery(api, c)
    assert c['delivery_status']=='Completa'
    assert next(task for task in c['tasks'] if task['id']==next_task['id'])['done_at'] is not None
    assert len([e for e in c['events'] if e['data'].get('action')=='pickup_followup_resolved'])==1


def test_complete_delivery_is_idempotent_and_cannot_register_partial_quantities_or_payments(clients):
    api=clients['admin'];_,c=create(api,'Entrega con abono')
    c=mutate(api,c,'take');c=mutate(api,c,'convert',conversion())
    c=release_single_order(clients,c)
    owner=c['owner_id']; stage=c['production']['stage']
    c=mutate(api,c,'attention',{'status':'Cerrado'})
    assert c['production']['stage']==stage and c['owner_id']==owner
    assert must(api.get('/api/cases?view=mine'))['total']==1
    assert must(api.get('/api/cases?view=action'))['total']==0
    payload={'version':c['version'],'key':key(),'production_id':c['production']['id'],'method':'Retiro en local','receiver':'Cliente','evidence':'Recibo 01','balance_reason':'Entrega excepcional de prueba'}
    rejected=api.post(f'/api/cases/{c["id"]}/deliveries',json={'version':c['version'],'key':key(),'production_id':c['production']['id'],'item_id':c['items'][0]['id'],'quantity':'1','delivered_at':datetime.now(timezone.utc).isoformat(),'receiver':'Cliente','method':'Retiro','evidence':'Parcial'})
    assert rejected.status_code==410
    unchanged=must(api.get(f'/api/cases/{c["id"]}'))
    assert len(unchanged['deliveries'])==0 and len(unchanged['ledger'])==1
    printer=clients['agent']
    forbidden={**payload,'version':unchanged['version'],'key':key()}
    assert printer.post(f'/api/cases/{c["id"]}/deliveries/complete',json=forbidden).status_code==403
    unchanged=must(api.get(f'/api/cases/{c["id"]}'))
    assert len(unchanged['deliveries'])==0 and len(unchanged['ledger'])==1
    c=must(api.post(f'/api/cases/{c["id"]}/deliveries/complete',json=payload))
    replay=must(api.post(f'/api/cases/{c["id"]}/deliveries/complete',json=payload))
    assert replay['delivery_status']=='Completa' and len(replay['deliveries'])==1
    assert len(replay['ledger'])==1 and replay['balance']=='1000.00'
    final={**payload,'version':replay['version'],'key':key()}
    assert api.post(f'/api/cases/{c["id"]}/deliveries/complete',json=final).status_code==409
    assert c['delivery_status']=='Completa' and c['production']['stage']=='READY'
    assert c['production']['result_label']=='Entregado' and c['production']['active_elapsed_seconds'] is None
    assert must(api.get('/api/cases?view=production'))['total']==0
    assert must(api.get('/api/cases?view=balances'))['total']==1


def test_historical_ambiguous_stage_requires_explicit_classification(clients):
    api=clients['admin'];_,c=create(api,'Clasificación heredada')
    c=mutate(api,c,'take');c=mutate(api,c,'convert',conversion())
    with SessionLocal.begin() as db:
        production=db.get(Production,c['production']['id'])
        production.legacy_stage='En producción'
        production.stage=None
        production.classification_required=True
    c=must(api.get(f'/api/cases/{c["id"]}'))
    assert c['production']['stage'] is None and c['production']['legacy_stage']=='En producción'
    assert c['production']['stage_label']=='Pendiente de clasificación' and c['production']['active_elapsed_seconds'] is None
    assert clients['scanner'].post('/api/scanner/scan',json={'scan_id':'CGOP1:'+c['production']['scan_id']}).status_code==409
    c=mutate(api,c,'production/stage',{'stage':'PRINTING'})
    assert c['production']['stage']=='PRINTING' and not c['production']['classification_required']
    classified=[e for e in c['events'] if e['data'].get('action')=='stage_classified']
    assert len(classified)==1 and classified[0]['data']['origin']=='manual_classification'


def test_server_pagination_is_stable_and_counts_match_filters(clients):
    api=clients['admin']
    for n in range(5):
        create(api, f'Paginación {n}')
    first=must(api.get('/api/cases',params={'view':'action','page':1,'page_size':2}))
    second=must(api.get('/api/cases',params={'view':'action','page':2,'page_size':2}))
    third=must(api.get('/api/cases',params={'view':'action','page':3,'page_size':2}))
    ids=[r['id'] for page in (first,second,third) for r in page['items']]
    assert len(ids)==len(set(ids))==5
    assert first['total']==second['total']==third['total']==must(api.get('/api/counts'))['action']==5
    assert ids==sorted(ids,reverse=True)
    assert must(api.get('/api/cases',params={'view':'pool','page_size':2}))['total']==must(api.get('/api/counts'))['pool']==5


def test_counts_load_role_permissions_once(clients):
    role_lookups=[]
    def record_role_lookup(conn, cursor, statement, parameters, context, executemany):
        if 'from roles' in statement.lower():
            role_lookups.append(1)
    sqlalchemy_event.listen(engine, 'before_cursor_execute', record_role_lookup)
    try:
        must(clients['admin'].get('/api/counts'))
    finally:
        sqlalchemy_event.remove(engine, 'before_cursor_execute', record_role_lookup)
    assert len(role_lookups)==1


def test_client_contact_relations_and_new_hnl_contract(clients):
    api=clients['admin']
    customer,c=create(api,'Validar cliente y lempiras')
    other=must(api.post('/api/clients',json={'name':'Otro cliente'}),201)
    contact=must(api.post(f'/api/clients/{customer["id"]}/contacts',json={'name':'Contacto comercial','phone':'9999'}),201)
    assert must(api.get(f'/api/clients/{customer["id"]}/contacts'))==[contact]
    assert api.post('/api/cases',json={'client_id':other['id'],'contact_id':contact['id'],'subject':'Relación incorrecta','kind':'Cotización', 'creation_context':'pool'}).status_code==422
    c=mutate(api,c,'take')
    quote_body={'version':c['version'],'key':key(),'items':[item()],'currency':'USD','valid_until':str(today()+timedelta(days=10))}
    assert api.post(f'/api/cases/{c["id"]}/quotes',json=quote_body).status_code==422
    base={'version':c['version'],'key':key(),**conversion()}
    assert api.post(f'/api/cases/{c["id"]}/convert',json={**base,'currency':'USD'}).status_code==422
    assert api.post(f'/api/cases/{c["id"]}/convert',json={**base,'key':key(),'payment_terms':'Contado y Crédito'}).status_code==422
    c=must(api.post(f'/api/cases/{c["id"]}/convert',json=base))
    assert c['production']['currency']=='HNL' and c['production']['payment_terms']=='Contado'
    assert c['production']['authorized_at'] is None and c['production']['specs_snapshot']['items']
    assert c['production']['owner_id'] is None and 'substage' not in c['items'][0] and 'substage' not in c['production']['specs_snapshot']['items'][0]
    assert len([e for e in c['ledger'] if e['kind']=='Obligación'])==1
    assert api.post(f'/api/cases/{c["id"]}/production/approve',json={}).status_code in (404,405)
    assert api.post(f'/api/cases/{c["id"]}/production/items/{c["items"][0]["id"]}',json={}).status_code in (404,405)


def test_legacy_usd_records_are_not_reused_or_repriced(clients,accounts):
    api=clients['admin'];_,c=create(api,'Trabajo USD histórico');c=mutate(api,c,'take')
    with SessionLocal.begin() as db:
        quote=Quote(case_id=c['id'],version=1,items=[item()],total=Decimal('1000'),currency='USD',valid_until=today()+timedelta(days=2),status='Aceptada')
        db.add(quote);db.flush();quote_id=quote.id
    c=must(api.get(f'/api/cases/{c["id"]}'))
    result=api.post(f'/api/cases/{c["id"]}/convert',json={'version':c['version'],'key':key(),**conversion(),'items':[],'quote_id':quote_id})
    assert result.status_code==409 and 'USD' in result.json()['detail']
    assert must(api.get(f'/api/cases/{c["id"]}'))['production'] is None
    with SessionLocal.begin() as db:
        case=db.get(Case,c['id']);case.mode='Producción'
        db.add(Production(case_id=case.id,price=Decimal('1000'),currency='USD',payment_terms='Crédito comercial 30 días',advance_required=0,payment_due_date=today(),delivery_method='Retiro'))
        db.flush()
        production_id=db.scalar(select(Production.id).where(Production.case_id==case.id))
        product=Item(case_id=case.id,production_id=production_id,product=item()['product'],quantity=Decimal('100'),unit='unidades',unit_price=Decimal('10'),specs={})
        db.add(product);db.add(Ledger(case_id=case.id,production_id=production_id,kind='Obligación',amount=Decimal('1000'),currency='USD',due_date=today(),reference='Histórico USD',actor_id=accounts['admin']['id']))
    c=must(api.get(f'/api/cases/{c["id"]}'))
    assert c['production']['currency']=='USD' and c['production']['payment_terms']=='Crédito comercial 30 días' and c['balance']=='1000.00'
    payment=api.post(f'/api/cases/{c["id"]}/payments',json={'version':c['version'],'key':key(),'amount':'10','reference':'No mezclar moneda'})
    assert payment.status_code==409
    unchanged=must(api.get(f'/api/cases/{c["id"]}'))
    assert unchanged['balance']=='1000.00' and len(unchanged['ledger'])==1


def test_production_quote_delivery_debt_and_idempotent_payment(clients,accounts):
    api=clients['admin']
    _,c=create(api,'Tarjetas para sucursal')
    c=mutate(api,c,'take')
    c=mutate(api,c,'events',{'kind':'Nota interna','channel':'Nota','body':'Conservar esta conversación'})
    c=mutate(api,c,'quotes',{'items':[item()],'currency':'HNL','valid_until':str(today()+timedelta(days=15))})
    quote=c['quotes'][0]
    assert c['mode']=='Atención'
    c=mutate(api,c,f'quotes/{quote["id"]}/decision',{'status':'Aceptada','evidence':'Cliente acepta presencialmente la versión 1'})
    c=mutate(api,c,'convert',{**conversion(accounts['printer']['id']),'items':[],'quote_id':quote['id']})
    assert c['id']==quote['case_id'] and c['mode']=='Producción'
    assert c['items'][0]['quantity']=='100.000' and c['production']['stage']=='APPROVAL'
    assert any(e['body']=='Conservar esta conversación' for e in c['events'])
    generated=next(e for e in c['events'] if e['data'].get('action')=='converted')
    assert generated['data']['order_number']==f'OP-{c["production"]["id"]:05d}'
    assert generated['data']['quote_number']==f'COT-{quote["id"]:05d}' and generated['data']['quote_version']==quote['version']
    assert c['balance']=='1000.00'
    c=mutate(api,c,'production/schedule',{'scheduled_at':datetime.now(timezone.utc).isoformat(),'committed_date':str(today()+timedelta(days=2))})
    schedule_event=next(e for e in c['events'] if e['data'].get('action')=='schedule')
    assert schedule_event['data']['current']['committed_date']==str(today()+timedelta(days=2))
    calendar_events = must(api.get('/api/calendar'))
    assert len(calendar_events)==3
    assert {event['type'] for event in calendar_events} == {'Inicio programado de producción', 'Entrega comprometida', 'Vencimiento de pago'}
    c=mutate(api,c,'production/stage',{'stage':'PRINTING'})
    assert c['production']['authorized_at'] is None
    upload=api.post(f'/api/cases/{c["id"]}/attachments',files={'file':('arte.pdf',b'%PDF-1.4\n%%EOF','application/pdf')},data={'art_version':'v1'})
    must(upload,201)
    c=must(api.get(f'/api/cases/{c["id"]}'))
    payment={'version':c['version'],'key':key(),'kind':'Anticipo','amount':'100.00','reference':'Recibo 001'}
    c=must(api.post(f'/api/cases/{c["id"]}/payments',json=payment))
    repeated=must(api.post(f'/api/cases/{c["id"]}/payments',json=payment))
    assert repeated['balance']=='900.00' and len(repeated['ledger'])==2
    assert c['production']['specs_snapshot']['items'][0]['specs']['material']=='Couché 300 g'
    c=mutate(api,c,'production/block',{'reason':'Falta material'})
    mutate(api,c,'production/stage',{'stage':'READY'},409)
    c=mutate(api,c,'production/unblock',{'reason':'Material recibido'})
    c=mutate(api,c,'production/stage',{'stage':'WORKSHOP'})
    mutate(api,c,'production/stage',{'stage':'APPROVAL'},422)
    c=mutate(api,c,'production/stage',{'stage':'PRINTING','reason':'Retrabajo por diferencia de color'})
    c=mutate(api,c,'production/stage',{'stage':'WORKSHOP'})
    c=must(api.get(f'/api/cases/{c["id"]}'))
    result=scan_order(clients,c)
    assert result['result']=='released'
    c=must(api.get(f'/api/cases/{c["id"]}'))
    assert c['delivery_status']=='Pendiente'
    c=complete_delivery(api, c)
    assert c['delivery_status']=='Completa' and c['production']['stage']=='READY' and c['lifecycle']=='Activo'
    c=mutate(api,c,'attention',{'status':'Cerrado'})
    assert must(api.get('/api/cases?view=balances'))['total']==1
    assert c['production']['stage']=='READY' and c['delivery_status']=='Completa' and c['production']['result_label']=='Entregado' and c['status']=='Cerrado'
    assert Decimal(c['overdue_balance'])==Decimal('900')
    c=mutate(api,c,'payments',{'amount':'900','reference':'Recibo 002'})
    assert c['payment_status']=='Pagado'
    assert c['lifecycle']=='Completado'
    assert clients['scanner'].post('/api/scanner/scan',json={'scan_id':'CGOP1:'+c['production']['scan_id']}).status_code==409
    entry=c['ledger'][-1]['id']
    mutate(api,c,f'payments/{entry}/reverse',{'reason':'Transferencia rechazada'},409)
    c=mutate(api,c,'reactivate')
    c=mutate(api,c,f'payments/{entry}/reverse',{'reason':'Transferencia rechazada'})
    assert c['balance']=='900.00'
    mutate(api,c,f'payments/{entry}/reverse',{'reason':'No duplicar reversión'},409)
    kpi=must(api.get('/api/indicators'))
    assert kpi['collection']['delivered_pending']==1


def test_simultaneous_take_convert_and_payment(clients,accounts):
    api=clients['admin'];_,c=create(api)
    def take(client):return client.post(f'/api/cases/{c["id"]}/take',json={'version':c['version'],'key':key()})
    with ThreadPoolExecutor(2) as pool:
        results=list(pool.map(take,[clients['agent'],clients['agent2']]))
    assert sorted(r.status_code for r in results)==[200,409]
    c=must(api.get(f'/api/cases/{c["id"]}'))
    payload={'version':c['version'],'key':key(),**conversion(accounts['printer']['id'])}
    with ThreadPoolExecutor(2) as pool:
        results=list(pool.map(lambda _:api.post(f'/api/cases/{c["id"]}/convert',json=payload),range(2)))
    assert all(r.status_code==200 for r in results)
    c=must(api.get(f'/api/cases/{c["id"]}'))
    assert len(c['items'])==1 and len(c['ledger'])==1
    c=mutate(api,c,'convert',conversion())
    assert c['production_count']==2 and len(c['ledger'])==1
    payload={'version':c['version'],'key':key(),'production_id':c['production']['id'],'amount':'50','reference':'Concurrente'}
    with ThreadPoolExecutor(2) as pool:
        results=list(pool.map(lambda _:api.post(f'/api/cases/{c["id"]}/payments',json=payload),range(2)))
    assert all(r.status_code==200 for r in results)
    c=must(api.get(f'/api/cases/{c["id"]}?production_id={c["production"]["id"]}'))
    assert len(c['ledger'])==2 and c['balance']=='950.00'


def test_permissions_files_csrf_and_cancellation(clients,accounts):
    api=clients['admin'];_,c=create(api)
    assert must(api.get('/api/auth/me'))['timezone']==settings.app_timezone
    assert clients['printer'].get(f'/api/cases/{c["id"]}').status_code==404
    assert clients['agent'].post('/api/users',json={'username':'bad','name':'Bad','password':'no-default-password','roles':['Administrador']}).status_code==403
    assert api.post('/api/clients',json={'name':'CSRF'},headers={'X-Comgraf-Request':'0'}).status_code==403
    assert api.post('/api/clients',json={'name':'CSRF'},headers={'Origin':'https://external.invalid'}).status_code==403
    c=mutate(api,c,'take');c=mutate(api,c,'convert',conversion())
    printer=must(clients['printer'].get(f'/api/cases/{c["id"]}'))
    assert 'balance' not in printer and 'price' not in printer['production'] and printer['ledger']==[]
    mutate(clients['printer'],c,'payments',{'amount':'5','reference':'No permitido'},403)
    mutate(clients['cashier'],c,'production/stage',{'stage':'APPROVAL'},403)
    mutate(clients['agent'],c,'events',{'kind':'Nota interna','channel':'Nota','body':'Sin permiso para modificar'},403)
    mutate(api,c,'events',{'kind':'Nota interna','channel':'WhatsApp','body':'No enviar nota'},422)
    bad=api.post(f'/api/cases/{c["id"]}/attachments',files={'file':('evil.pdf',b'<script>bad</script>','application/pdf')})
    assert bad.status_code==422
    c=mutate(api,c,'payments',{'amount':'100','reference':'Anticipo'})
    c=mutate(api,c,'production/cancel',{'reason':'Cliente cancela pedido','treatment':'IMPORTE_FINAL','final_amount':'1000.00'})
    assert c['balance']=='900.00' and len(c['ledger'])==2 and c['production']['cancelled_at']
    assert clients['scanner'].post('/api/scanner/scan',json={'scan_id':'CGOP1:'+c['production']['scan_id']}).status_code==409


def test_cancellation_final_amount_refunds_and_idempotency(clients):
    api=clients['admin']
    _,c=create(api,'Anulación con anticipo')
    c=mutate(api,c,'take'); c=mutate(api,c,'convert',conversion())
    c=mutate(api,c,'payments',{'amount':'300.00','reference':'Anticipo real'})
    body={'version':c['version'],'key':key(),'reason':'Cliente acordó conservar solo diseño','treatment':'IMPORTE_FINAL','final_amount':'200.00'}
    c=must(api.post(f'/api/cases/{c["id"]}/production/cancel',json=body))
    assert c['balance']=='-100.00' and c['payment_status']=='A favor'
    assert c['production']['cancellation_final_amount']=='200.00'
    assert [entry['kind'] for entry in c['ledger']][-1]=='Ajuste de anulación'
    same=must(api.post(f'/api/cases/{c["id"]}/production/cancel',json=body))
    assert same['balance']=='-100.00' and len(same['ledger'])==3
    refund_body={'version':c['version'],'key':key(),'amount':'50.00','reference':'Transferencia 01'}
    c=must(api.post(f'/api/cases/{c["id"]}/production/refunds',json=refund_body))
    assert c['balance']=='-50.00'
    over={**refund_body,'version':c['version'],'key':key(),'amount':'50.01'}
    assert api.post(f'/api/cases/{c["id"]}/production/refunds',json=over).status_code==422
    refund_body['version']=c['version']
    c=must(api.post(f'/api/cases/{c["id"]}/production/refunds',json=refund_body))
    repeated=must(api.post(f'/api/cases/{c["id"]}/production/refunds',json=refund_body))
    assert repeated['balance']=='-50.00' and len(repeated['ledger'])==4
    assert c['lifecycle']=='Activo'
    assert api.get('/api/cases?view=mine').json()['total']==1
    assert api.get('/api/cases?view=finalized').json()['total']==0
    assert api.get('/api/cases?view=refunds').json()['total']==1


def test_cancellation_without_payment_clears_charge_and_cannot_fake_refund(clients):
    api=clients['admin'];_,c=create(api,'Anulación sin anticipo')
    c=mutate(api,c,'take');c=mutate(api,c,'convert',conversion())
    c=mutate(api,c,'production/cancel',{'reason':'El cliente desistió','treatment':'SIN_CARGO'})
    assert c['balance']=='0.00' and c['payment_status']=='Pagado'
    assert c['production']['cancellation_final_amount']=='0.00'
    assert len([x for x in c['ledger'] if x['kind']=='Ajuste de anulación'])==1
    assert c['production']['active_elapsed_seconds'] is None
    c=mutate(api,c,'attention',{'status':'Cerrado'})
    assert c['lifecycle']=='Activo'
    c=mutate(api,c,'complete')
    assert api.get('/api/cases?view=mine').json()['total']==0
    assert api.get('/api/cases?view=finalized').json()['total']==1


def test_cancellation_without_finance_queues_review_then_resolves(clients,accounts):
    with SessionLocal.begin() as db:
        role_name='Anulador'+key()[:8]
        db.add(Role(name=role_name,permissions=['production']))
        user=User(username='cancelador',name='Cancelador',password_hash='unused',roles=[role_name],capacity=20)
        db.add(user);db.flush(); uid=user.id
    api=TestClient(app,headers={'X-Comgraf-Request':'1','X-Comgraf-Contract':'5'})
    with SessionLocal.begin() as db:
        user=db.get(User,uid)
        user.password_hash=__import__('app.security',fromlist=['passwords']).passwords.hash('cancelador-password-2026')
    must(api.post('/api/auth/login',json={'username':'cancelador','password':'cancelador-password-2026'}))
    admin=clients['admin'];_,c=create(admin,'Anulación con revisión')
    c=mutate(admin,c,'take');c=mutate(admin,c,'convert',conversion())
    c=must(api.post(f'/api/cases/{c["id"]}/production/cancel',json={'version':c['version'],'key':key(),'reason':'Solicitar revisión económica'}))
    assert c['production']['cancellation_review_pending'] and c['payment_status']=='Revisión de anulación'
    assert api.get('/api/cases?view=cancellation-review').status_code==403
    assert admin.get('/api/cases?view=cancellation-review').json()['total']==1
    denied=api.post(f'/api/cases/{c["id"]}/production/cancel/resolve',json={'version':c['version'],'key':key(),'reason':'No debe modificar el cargo','treatment':'SIN_CARGO'})
    assert denied.status_code==403
    resolved=mutate(clients['admin'],c,'production/cancel/resolve',{'reason':'Acuerdo revisado','treatment':'SIN_CARGO'})
    assert not resolved['production']['cancellation_review_pending'] and resolved['balance']=='0.00'
    api.close()


def test_due_sort_is_mysql_compatible_and_filters_validate(clients):
    api=clients['admin'];_,c=create(api,'Orden sin compromiso')
    c=mutate(api,c,'take');c=mutate(api,c,'convert',conversion())
    result=api.get('/api/cases?view=mine&sort=due')
    assert result.status_code==200, result.text
    assert result.json()['items'][0]['id']==c['id']
    assert api.get('/api/cases?view=mine&due=fecha-mala').status_code==422
    assert api.get('/api/cases?view=mine&client_id=texto').status_code==422
    mismatch=api.post(f'/api/cases/{c["id"]}/take',json={'version':c['version'],'key':key()},headers={'X-Comgraf-Contract':'1'})
    assert mismatch.status_code==409 and mismatch.json()['code']=='CLIENT_CONTRACT_MISMATCH'
