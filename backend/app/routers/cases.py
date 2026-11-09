from fastapi import APIRouter, Depends, HTTPException, Request, BackgroundTasks
import hashlib
import json
from sqlalchemy import func, select
from ..db import get_db
from ..models import Case, Client, Contact, CreationRequest, Draft, Production, SavedView, User
from .. import schemas as s, services as service
from ..security import current_user, require
from ..repository import row, get_case, case_detail, cases_list, case_counts, orders_list, attention_predicates, normalize
from .common import case_response
from ..deletion import require_admin, preview_cases, delete_case, retry_file_cleanup
from pydantic import BaseModel


class DeleteConfirmation(BaseModel):
    preview: dict
    confirmation: str

router = APIRouter(prefix='/api', tags=['Expedientes'])


@router.get('/cases/{case_id}/delete-preview')
def case_delete_preview(case_id: int, user=Depends(current_user), db=Depends(get_db, scope='function')):
    require_admin(user)
    case = db.get(Case, case_id)
    if not case: raise HTTPException(404, 'La solicitud ya no existe')
    return preview_cases(db, [case])


@router.post('/cases/{case_id}/delete-definitively')
def case_delete_confirm(case_id: int, data: DeleteConfirmation, background: BackgroundTasks, user=Depends(current_user), db=Depends(get_db, scope='function')):
    require_admin(user)
    if data.confirmation.strip().casefold() != 'comgraf':
        raise HTTPException(422, 'Para confirmar la eliminación definitiva, escribe comgraf')
    delete_case(db, user, case_id, data.preview)
    background.add_task(retry_file_cleanup)
    return {'deleted': True}


@router.get('/cases')
def list_cases(request: Request, user=Depends(current_user), db=Depends(get_db, scope='function')):
    return cases_list(db, user, dict(request.query_params))


@router.get('/counts')
def counts(user=Depends(current_user), db=Depends(get_db, scope='function')):
    return case_counts(db, user)


@router.patch('/cases/{case_id}/title')
def edit_title(case_id: int, data: s.TitleInput, user=Depends(current_user), db=Depends(get_db, scope='function')):
    case = get_case(db, user, case_id, lock=True)
    service.change_title(db, user, case, data)
    return case_response(db, user, case)


@router.get('/production-clients')
def production_clients(q: str = '', user=Depends(current_user), db=Depends(get_db, scope='function')):
    require(db, user, 'production')
    # Búsqueda acotada para crear OP: no expone RTN, teléfonos, correos ni el perfil comercial.
    query = select(Client).order_by(Client.name)
    if q:
        query = query.where(Client.search_text.contains(normalize(q)))
    return [{'id': client.id, 'name': client.name, 'company': client.company or '', 'provisional': client.provisional}
            for client in db.scalars(query)]


@router.get('/production-clients/{client_id}/contacts')
def production_client_contacts(client_id: int, user=Depends(current_user), db=Depends(get_db, scope='function')):
    require(db, user, 'production')
    if not db.get(Client, client_id): raise HTTPException(404, 'Cliente no encontrado')
    return [{'id': contact.id, 'name': contact.name} for contact in db.scalars(
        select(Contact).where(Contact.client_id == client_id).order_by(Contact.name))]


@router.get('/orders')
def list_orders(request: Request, user=Depends(current_user), db=Depends(get_db, scope='function')):
    return orders_list(db, user, dict(request.query_params))


@router.post('/cases', status_code=201)
def create(data: s.CaseInput, user=Depends(current_user), db=Depends(get_db, scope='function')):
    require(db, user, 'attention')
    if data.creation_context == 'personal':
        db.scalar(select(User).where(User.id == user.id).with_for_update())
        pending = attention_predicates()['pending_assignment']
        count = db.scalar(select(func.count()).select_from(Case).where(Case.owner_id == user.id, pending))
        if count >= user.capacity:
            raise HTTPException(409, 'Alcanzaste tu capacidad de solicitudes pendientes (atención, producción, seguimiento o saldo)')
    if not db.get(Client, data.client_id): raise HTTPException(422, 'Cliente no encontrado')
    if data.contact_id:
        contact = db.get(Contact, data.contact_id)
        if not contact or contact.client_id != data.client_id: raise HTTPException(422, 'El contacto no pertenece al cliente')
    if data.related_case_id: get_case(db, user, data.related_case_id)
    values = data.model_dump(exclude={'creation_context'})
    values['owner_id'] = None if data.creation_context == 'pool' else user.id
    case = Case(**values)
    db.add(case)
    db.flush()
    label = 'orden de producción' if case.kind == 'Solicitud' else case.kind.lower()
    service.event(db, case, user, f'Solicitud de {label} creada', data={'action': 'created'})
    return case_response(db, user, case)


@router.post('/production-requests', status_code=201)
def create_production_request(data: s.ProductionRequestInput, user=Depends(current_user), db=Depends(get_db, scope='function')):
    require(db, user, 'production')
    # Serializar las creaciones por usuario hace idempotentes los reintentos simultáneos.
    db.scalar(select(User).where(User.id == user.id).with_for_update())
    payload = data.model_dump(mode='json', exclude={'version'})
    signature = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    previous = db.scalar(select(CreationRequest).where(CreationRequest.user_id == user.id, CreationRequest.key == data.key))
    if previous:
        if previous.request_hash != signature:
            raise HTTPException(409, 'La clave de reintento ya pertenece a otra creación')
        case = get_case(db, user, previous.case_id)
        production_id = db.scalar(select(Production.id).where(Production.case_id == case.id).order_by(Production.id.desc()).limit(1))
        return case_response(db, user, case, production_id)
    pending = attention_predicates()['pending_assignment']
    count = db.scalar(select(func.count()).select_from(Case).where(Case.owner_id == user.id, pending))
    if count >= user.capacity:
        raise HTTPException(409, 'Alcanzaste tu capacidad de solicitudes pendientes (atención, producción, seguimiento o saldo)')
    if not db.get(Client, data.client_id): raise HTTPException(422, 'Cliente no encontrado')
    contact = db.get(Contact, data.contact_id) if data.contact_id else None
    if data.contact_id and (not contact or contact.client_id != data.client_id): raise HTTPException(422, 'El contacto no pertenece al cliente')
    case = Case(client_id=data.client_id, contact_id=data.contact_id, subject=data.subject, description=data.description,
                kind='Solicitud', priority=data.priority, mode='Producción', owner_id=user.id)
    db.add(case)
    db.flush()
    service.event(db, case, user, 'Solicitud de orden de producción creada', data={'action': 'created'})
    service.convert(db, user, case.id, data, permission='production')
    db.add(CreationRequest(user_id=user.id, key=data.key, request_hash=signature, case_id=case.id))
    production_id = db.scalar(select(Production.id).where(Production.case_id == case.id).order_by(Production.id.desc()).limit(1))
    return case_response(db, user, case, production_id)


@router.get('/cases/{case_id}')
def detail(case_id: int, production_id: int | None = None, user=Depends(current_user), db=Depends(get_db, scope='function')):
    return case_detail(db, user, get_case(db, user, case_id), production_id)


@router.post('/cases/{case_id}/take')
def take(case_id: int, data: s.Mutation, user=Depends(current_user), db=Depends(get_db, scope='function')):
    return case_response(db, user, service.take(db, user, case_id, data))


@router.post('/cases/{case_id}/assign')
def assign(case_id: int, data: s.Assignment, user=Depends(current_user), db=Depends(get_db, scope='function')):
    return case_response(db, user, service.assign(db, user, case_id, data))


@router.post('/cases/{case_id}/attention')
def attention(case_id: int, data: s.CaseUpdate, user=Depends(current_user), db=Depends(get_db, scope='function')):
    return case_response(db, user, service.update_case(db, user, case_id, data))


@router.post('/cases/{case_id}/complete')
def complete_case(case_id: int, data: s.CaseLifecycleInput, user=Depends(current_user), db=Depends(get_db, scope='function')):
    return case_response(db, user, service.complete_case(db, user, case_id, data))


@router.post('/cases/{case_id}/reactivate')
def reactivate_case(case_id: int, data: s.CaseLifecycleInput, user=Depends(current_user), db=Depends(get_db, scope='function')):
    return case_response(db, user, service.reactivate_case(db, user, case_id, data))


@router.post('/cases/{case_id}/details')
def details(case_id: int, data: s.CaseDetailsInput, user=Depends(current_user), db=Depends(get_db, scope='function')):
    return case_response(db, user, service.update_case_details(db, user, case_id, data))


@router.post('/cases/{case_id}/events')
def events(case_id: int, data: s.EventInput, user=Depends(current_user), db=Depends(get_db, scope='function')):
    return case_response(db, user, service.add_event(db, user, case_id, data))


@router.post('/cases/{case_id}/tasks')
def tasks(case_id: int, data: s.TaskInput, user=Depends(current_user), db=Depends(get_db, scope='function')):
    return case_response(db, user, service.add_task(db, user, case_id, data))


@router.post('/cases/{case_id}/tasks/{task_id}/complete')
def complete(case_id: int, task_id: int, data: s.TaskCompletionInput, user=Depends(current_user), db=Depends(get_db, scope='function')):
    return case_response(db, user, service.complete_task(db, user, case_id, task_id, data))


@router.put('/cases/{case_id}/tasks/{task_id}')
def reschedule_task(case_id: int, task_id: int, data: s.TaskReschedule, user=Depends(current_user), db=Depends(get_db, scope='function')):
    return case_response(db, user, service.reschedule_task(db, user, case_id, task_id, data))


@router.post('/cases/{case_id}/quotes')
def quote(case_id: int, data: s.QuoteInput, user=Depends(current_user), db=Depends(get_db, scope='function')):
    return case_response(db, user, service.add_quote(db, user, case_id, data))


@router.post('/cases/{case_id}/quotes/{quote_id}/decision')
def decision(case_id: int, quote_id: int, data: s.QuoteDecision, user=Depends(current_user), db=Depends(get_db, scope='function')):
    return case_response(db, user, service.decide_quote(db, user, case_id, quote_id, data))


@router.post('/cases/{case_id}/convert')
def convert(case_id: int, data: s.Conversion, user=Depends(current_user), db=Depends(get_db, scope='function')):
    case = service.convert(db, user, case_id, data)
    production_id = db.scalar(select(Production.id).where(Production.case_id == case.id).order_by(Production.id.desc()).limit(1))
    return case_response(db, user, case, production_id)


@router.get('/views')
def views(user=Depends(current_user), db=Depends(get_db, scope='function')):
    result = []
    for saved in db.scalars(select(SavedView).where(SavedView.user_id == user.id)):
        value = row(saved)
        value['filters'] = normalized_saved_filters(value['filters'])
        result.append(value)
    return result


def normalized_saved_filters(filters):
    filters = dict(filters or {})
    view = filters.get('view')
    if view == 'pool':
        return {key: value for key, value in filters.items() if key in ('view', 'sort', 'page')}
    if view in ('action', 'mine-action'):
        filters.pop('status', None)
        filters.pop('lifecycle', None)
    elif view == 'mine':
        filters.pop('lifecycle', None)
    return filters


@router.post('/views')
def save_view(data: s.ViewInput, user=Depends(current_user), db=Depends(get_db, scope='function')):
    allowed = {'view', 'status', 'mode', 'priority', 'stage', 'payment', 'blocked', 'due', 'action', 'sort', 'page'}
    if set(data.filters) - allowed: raise HTTPException(422, 'Filtros no reconocidos')
    view = db.scalar(select(SavedView).where(SavedView.user_id == user.id, SavedView.name == data.name))
    if not view:
        view = SavedView(user_id=user.id, name=data.name)
        db.add(view)
    filters = normalized_saved_filters(data.filters)
    view.filters = filters
    db.flush()
    return row(view)


@router.put('/cases/{case_id}/drafts/{channel}')
def draft(case_id: int, channel: str, data: s.DraftInput, user=Depends(current_user), db=Depends(get_db, scope='function')):
    require(db, user, 'attention')
    case = get_case(db, user, case_id, lock=True)
    if case.lifecycle == 'Completado': raise HTTPException(409, 'Reactiva la solicitud antes de guardar borradores nuevos')
    if channel != 'Nota': raise HTTPException(422, 'Solo se pueden guardar borradores de notas')
    draft = db.scalar(select(Draft).where(Draft.case_id == case_id, Draft.user_id == user.id, Draft.channel == channel))
    if draft and draft.version != data.version: raise HTTPException(409, 'El borrador cambió en otra sesión')
    if not draft:
        if data.version: raise HTTPException(409, 'El borrador cambió')
        draft = Draft(case_id=case_id, user_id=user.id, channel=channel, version=0)
        db.add(draft)
    draft.body = data.body
    draft.version += 1
    db.flush()
    return row(draft)
