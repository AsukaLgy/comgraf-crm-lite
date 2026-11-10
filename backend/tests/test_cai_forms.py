from itertools import product
import pytest
from pydantic import ValidationError
from app.schemas import ItemInput
from app.db import SessionLocal
from app.models import Client, Quote
from test_workflows import create, key, must, mutate, conversion


FORMATS = ['Media carta', 'Cuarto de carta', '8.5 × 7.25', '8.5 × 8.5', 'Carta']


def cai_item(**changes):
    item = {'product':'Talonario CAI','quantity':'10','unit':'talonarios','unit_price':'125.00',
            'specs':{'cai_format':'Media carta','games_per_pad':50,'paper_type':'Químico','additional_copies':2,'cai_binding':'Engrapado','detail':'Original y copias autocopiativas'}}
    item.update(changes)
    return item


def test_all_cai_selector_combinations_are_valid_and_closed():
    for form, games, paper, copies in product(FORMATS, (10,25,50), ('Bond','Químico'), (1,2,3)):
        for binding in ('Engrapado','Pegado','Hojas sueltas'):
            ItemInput.model_validate(cai_item(specs={'cai_format':form,'games_per_pad':games,'paper_type':paper,'additional_copies':copies,'cai_binding':binding}))
    with pytest.raises(ValidationError):
        ItemInput.model_validate(cai_item(specs={'cai_format':'Folio','games_per_pad':50,'paper_type':'Bond','additional_copies':1}))
    with pytest.raises(ValidationError):
        ItemInput.model_validate(cai_item(quantity='1.5'))
    with pytest.raises(ValidationError):
        ItemInput.model_validate(cai_item(unit='juegos'))
    with pytest.raises(ValidationError):
        ItemInput.model_validate(cai_item(specs={'cai_format':'Media carta','games_per_pad':50,'paper_type':'Bond','additional_copies':1}))
    with pytest.raises(ValidationError):
        ItemInput.model_validate(cai_item(specs={'cai_format':'Media carta','games_per_pad':50,'paper_type':'Bond','additional_copies':1,'cai_binding':'Espiral'}))
    for invalid in (0, -1, 1.5, '1.5', '', 10001):
        with pytest.raises(ValidationError):
            ItemInput.model_validate(cai_item(specs={**cai_item()['specs'], 'games_per_pad': invalid}))


def test_cai_order_uses_pads_as_commercial_quantity_and_snapshots_client(clients):
    api=clients['admin']; customer,case=create(api,'Facturación CAI')
    invalid=api.post(f"/api/cases/{case['id']}/convert",json={**conversion(),'items':[cai_item(specs={'cai_format':'Folio','games_per_pad':50,'paper_type':'Químico','additional_copies':2})],'version':case['version'],'key':key()})
    assert invalid.status_code==422
    order=mutate(api,case,'convert',{**conversion(),'items':[cai_item()]})
    production=order['production']
    assert production['price']=='1250.00' and production['stage']=='APPROVAL'
    summary=production['specs_snapshot']['items'][0]['cai_summary']
    assert summary=={'total_games':500,'sheets_per_game':3,'finished_sheets':1500}
    assert order['items'][0]['quantity']=='10.000' and order['items'][0]['unit']=='talonarios'
    assert production['client_snapshot']=={'client_id':customer['id'],'contact_id':None,'company':'Gráfica Norte','person':'','rtn':'08011990001234','phone':'+504 9999-1234','email':'maria@example.test'}

    changed={'name':customer['name'],'company':'Empresa actualizada','rtn':'11111111111111','phones':customer['phones'],'emails':customer['emails'],'addresses':customer['addresses'],'observations':customer['observations'],'provisional':customer['provisional'],'version':customer['version']}
    assert api.put(f"/api/clients/{customer['id']}",json=changed).status_code==200
    reopened=must(api.get(f"/api/cases/{case['id']}?production_id={production['id']}"))
    assert reopened['production']['client_snapshot']['company']=='Gráfica Norte'
    second=mutate(api,reopened,'convert',{**conversion(),'items':[cai_item(quantity='2')]})
    assert second['production']['scan_id']!=production['scan_id']
    first_again=must(api.get(f"/api/cases/{case['id']}?production_id={production['id']}"))
    assert first_again['production']['scan_id']==production['scan_id']


@pytest.mark.parametrize('games', [10, 25, 50])
def test_games_per_pad_are_validated_by_api_and_do_not_change_commercial_price(clients, games):
    api = clients['admin']
    _, case = create(api, f'{games} juegos por talonario')
    specs = {**cai_item()['specs'], 'games_per_pad': games}
    result = mutate(api, case, 'convert', {**conversion(), 'items': [cai_item(specs=specs)]})
    saved = result['production']['specs_snapshot']['items'][0]
    assert saved['specs']['games_per_pad'] == games
    assert saved['cai_summary'] == {'total_games': 10 * games, 'sheets_per_game': 3,
                                    'finished_sheets': 30 * games}
    assert result['production']['price'] == '1250.00'


def test_games_per_pad_invalid_values_are_rejected_by_api(clients):
    api = clients['admin']
    _, case = create(api, 'Juegos inválidos')
    for invalid in (0, -1, 1.5, '1.5', '', 10001, None):
        specs = {**cai_item()['specs'], 'games_per_pad': invalid}
        response = api.post(f"/api/cases/{case['id']}/convert", json={**conversion(),
            'items': [cai_item(specs=specs)], 'version': case['version'], 'key': key()})
        assert response.status_code == 422, (invalid, response.text)
    assert must(api.get(f"/api/cases/{case['id']}"))['production'] is None


def test_historical_quote_name_maps_to_single_current_product_without_rewriting_quote(clients):
    api = clients['admin']
    _, case = create(api, 'Cotización CAI histórica')
    quote = mutate(api, case, 'quotes', {'items': [cai_item()], 'valid_until': '2099-12-31'})
    quote_id = quote['quotes'][-1]['id']
    quote = mutate(api, quote, f'quotes/{quote_id}/decision', {'status': 'Aceptada', 'evidence': 'Aceptada'})
    with SessionLocal.begin() as db:
        historical = db.get(Quote, quote_id)
        old_items = [dict(row) for row in historical.items]
        old_items[0]['product'] = 'Recibos por honorarios (CAI)'
        historical.items = old_items
    order = mutate(api, quote, 'convert', {**conversion(), 'quote_id': quote_id, 'items': []})
    assert order['items'][0]['product'] == 'Talonario CAI'
    assert order['production']['specs_snapshot']['items'][0]['product'] == 'Talonario CAI'
    with SessionLocal() as db:
        assert db.get(Quote, quote_id).items[0]['product'] == 'Recibos por honorarios (CAI)'


def test_new_production_request_without_contact_uses_general_client_details(clients):
    api = clients['admin']
    customer, _ = create(api, 'Cliente con contacto adicional')
    must(api.post(f"/api/clients/{customer['id']}/contacts", json={
        'name': 'Contacto aparte', 'phone': '9999-1111', 'email': 'aparte@example.test'}), 201)
    created = must(api.post('/api/production-requests', json={**conversion(),
        'client_id': customer['id'], 'subject': 'Nueva OP sin contacto', 'version': 1, 'key': key()}), 201)
    assert created['owner_id'] is None and created['contact_id'] is None
    assert created['production']['contact_id'] is None
    snapshot = created['production']['client_snapshot']
    assert snapshot['contact_id'] is None
    assert snapshot['phone'] == customer['phones'][0]
    assert snapshot['email'] == customer['emails'][0]


def test_cai_binding_is_saved_per_product_line(clients):
    api=clients['admin']; _,case=create(api,'Dos acabados CAI')
    items=[cai_item(specs={**cai_item()['specs'],'cai_binding':'Engrapado'}),
           cai_item(quantity='2',specs={**cai_item()['specs'],'cai_binding':'Hojas sueltas'})]
    result=mutate(api,case,'convert',{**conversion(),'items':items})
    saved=result['production']['specs_snapshot']['items']
    assert [row['specs']['cai_binding'] for row in saved]==['Engrapado','Hojas sueltas']


def test_cai_contact_is_scoped_and_quote_conversion_preserves_specs(clients):
    api=clients['admin']; customer,case=create(api,'Cotización CAI')
    contact=must(api.post(f"/api/clients/{customer['id']}/contacts",json={'name':'Ana Gómez','phone':'9999-1111','email':'ana@example.test'}),201)
    quote=mutate(api,case,'quotes',{'items':[cai_item()],'currency':'HNL','valid_until':'2099-12-31'})
    quote_id=quote['quotes'][-1]['id']
    quote=mutate(api,quote,f'quotes/{quote_id}/decision',{'status':'Aceptada','evidence':'Aprobada por el cliente'})
    converted=mutate(api,quote,'convert',{**conversion(),'quote_id':quote_id,'items':[],'contact_id':contact['id'],'phone':'9999-1111','email':'ana@example.test'})
    saved=converted['production']['specs_snapshot']['items'][0]
    assert saved['specs']['cai_format']=='Media carta' and saved['specs']['games_per_pad']==50 and saved['specs']['cai_binding']=='Engrapado'
    assert converted['production']['contact_id']==contact['id']
    assert converted['production']['client_snapshot']['person']=='Ana Gómez'
    assert converted['production']['client_snapshot']['phone']=='9999-1111'

    other=must(api.post('/api/clients',json={'name':'Otra persona','phones':[],'emails':[]}),201)
    foreign=must(api.post(f"/api/clients/{other['id']}/contacts",json={'name':'Contacto ajeno'}),201)
    # Create a second active request; the out-of-scope contact must not be attachable.
    case2=must(api.post('/api/cases',json={'client_id':customer['id'],'subject':'Otra orden CAI','kind':'Solicitud','creation_context':'pool'}),201)
    invalid=api.post(f"/api/cases/{case2['id']}/convert",json={**conversion(),'items':[cai_item()],'contact_id':foreign['id'],'version':case2['version'],'key':key()})
    assert invalid.status_code==422 and 'no pertenece' in invalid.text


def test_historical_quote_without_binding_requires_selection_before_conversion(clients):
    api=clients['admin']; _,case=create(api,'Encuadernación histórica CAI')
    quote=mutate(api,case,'quotes',{'items':[cai_item()],'currency':'HNL','valid_until':'2099-12-31'})
    quote_id=quote['quotes'][-1]['id']
    quote=mutate(api,quote,f'quotes/{quote_id}/decision',{'status':'Aceptada','evidence':'Aceptada'})
    with SessionLocal.begin() as db:
        historical=db.get(Quote,quote_id)
        legacy_items=[dict(item) for item in historical.items]
        legacy_items[0]['specs']=dict(legacy_items[0]['specs'])
        legacy_items[0]['specs'].pop('cai_binding')
        historical.items=legacy_items
    body={**conversion(),'quote_id':quote_id,'items':[]}
    missing=api.post(f"/api/cases/{case['id']}/convert",json={**body,'version':quote['version'],'key':key()})
    assert missing.status_code==422 and 'encuadernación' in missing.text.lower()
    selected={**cai_item(specs={**cai_item()['specs'],'cai_binding':'Hojas sueltas'})}
    result=api.post(f"/api/cases/{case['id']}/convert",json={**body,'items':[selected],'version':quote['version'],'key':key()})
    assert result.status_code==200, result.text
    assert result.json()['production']['specs_snapshot']['items'][0]['specs']['cai_binding']=='Hojas sueltas'
    with SessionLocal() as db:
        assert 'cai_binding' not in db.get(Quote,quote_id).items[0]['specs']


def test_rtn_requires_fourteen_digits_and_preserves_leading_zero_and_legacy(clients):
    api=clients['admin']
    for invalid in ('1234567890123','123456789012345','1234567890123A','1234567 901234','123456789012.3',' 1234567890123 '):
        response=api.post('/api/clients',json={'name':'RTN inválido','rtn':invalid})
        assert response.status_code==422 and 'El RTN debe contener exactamente 14 dígitos.' in response.text
    provisional=must(api.post('/api/clients',json={'name':'Cliente provisional','rtn':''}),201)
    assert provisional['rtn']==''
    client=must(api.post('/api/clients',json={'name':'RTN válido','rtn':'01234567890123'}),201)
    assert client['rtn']=='01234567890123'
    old='0801-1990-00123'
    with SessionLocal.begin() as db:
        historical=db.get(Client,client['id'])
        historical.rtn=old
    current=must(api.get(f"/api/clients/{client['id']}"))
    unchanged={**{key:current[key] for key in ('name','company','rtn','phones','emails','addresses','observations','provisional')},'version':current['version'],'company':'Empresa corregida'}
    saved=must(api.put(f"/api/clients/{client['id']}",json=unchanged))
    assert saved['rtn']==old and saved['company']=='Empresa corregida'
    changed={**unchanged,'rtn':'1234567890123','version':saved['version']}
    rejected=api.put(f"/api/clients/{client['id']}",json=changed)
    assert rejected.status_code==422 and 'El RTN debe contener exactamente 14 dígitos.' in rejected.text
    corrected={**unchanged,'rtn':'00123456789012','version':saved['version']}
    saved=must(api.put(f"/api/clients/{client['id']}",json=corrected))
    assert saved['rtn']=='00123456789012'
