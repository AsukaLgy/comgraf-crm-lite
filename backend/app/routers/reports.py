from datetime import datetime, time, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from ..db import get_db
from ..models import Case, Client, Item, Production, Task, Delivery, now
from ..security import current_user, require, can
from ..repository import visibility, balance, row, delivery_status, local_day, today, case_query, _order_query, orders_count, order_item_predicates
from ..schemas import STAGE_LABELS
from ..config import settings

router = APIRouter(prefix='/api', tags=['Calendario e indicadores'])


@router.get('/calendar')
def calendar(user=Depends(current_user), db=Depends(get_db, scope='function')):
    events = []
    for case in db.scalars(select(Case).where(visibility(db, user))):
        client = db.get(Client, case.client_id)
        label = f'CG-{case.id:06d} · {client.name if client else case.subject}'
        for task in db.scalars(select(Task).where(Task.case_id == case.id, Task.done_at.is_(None))):
            order = db.get(Production, task.production_id) if task.production_id else None
            collection = task.purpose == 'COLLECTION'
            if collection and not (can(db, user, 'finance') or can(db, user, 'attention')):
                continue
            event_type = 'Seguimiento de cobro' if collection else 'Seguimiento de atención'
            events.append({'id': f't{task.id}', 'case_id': case.id, 'production_id': order.id if order else None,
                'type': event_type, 'event_kind': 'collection_followup' if collection else 'followup', 'date': row(task)['due_at'],
                'title': f'{label}{f" · OP-{order.id:05d}" if order else ""} · {task.title}',
                'order_number': f'OP-{order.id:05d}' if order else None,
                'action': task.title, 'date_label': 'Cobro programado el' if collection else 'Contactar el',
                'stage': STAGE_LABELS.get(order.stage) if order and order.stage else None,
                'state_label': 'Pendiente', 'owner_id': task.owner_id})
        for production in db.scalars(select(Production).where(Production.case_id == case.id).order_by(Production.id)):
            status = delivery_status(db, case.id, production.id)
            if production.cancelled_at: continue
            order_number = f'OP-{production.id:05d}'
            stage = STAGE_LABELS.get(production.stage) if production.stage else 'Pendiente de clasificación'
            order_context = f'{label} · {order_number}'
            if status != 'Completa' and production.stage in (None, 'NEW', 'APPROVAL') and production.scheduled_at:
                events.append({'id': f'p{production.id}', 'case_id': case.id, 'production_id': production.id,
                    'type': 'Inicio programado de producción', 'event_kind': 'scheduled', 'date': row(production)['scheduled_at'],
                    'date_label': 'Producción programada el', 'action': 'Iniciar producción', 'state_label': stage,
                    'title': order_context, 'order_number': order_number, 'stage': stage, 'stage_label': stage, 'owner_id': case.owner_id})
            if status != 'Completa' and production.committed_date:
                events.append({'id': f'd{production.id}', 'case_id': case.id, 'production_id': production.id,
                'type': 'Entrega comprometida', 'event_kind': 'committed', 'date': str(production.committed_date),
                'date_label': 'Entrega comprometida para', 'action': 'Completar y liberar la orden',
                'title': order_context, 'order_number': order_number, 'stage': stage, 'stage_label': stage,
                'state_label': 'Bloqueada · ' + production.block_reason if production.blocked_since else stage,
                'original': str(production.original_committed_date) if production.original_committed_date else None})
            order_balance = balance(db, case.id, production.id)['balance']
            if (can(db, user, 'finance') or can(db, user, 'attention')) and order_balance is not None and Decimal(order_balance) > 0 and production.payment_due_date:
                events.append({'id': f'm{production.id}', 'case_id': case.id, 'production_id': production.id,
                    'type': 'Vencimiento de pago', 'event_kind': 'payment_due', 'date': str(production.payment_due_date),
                    'date_label': 'Pago vence el', 'action': 'Revisar saldo pendiente', 'title': order_context,
                    'order_number': order_number, 'stage': stage,
                    'state_label': 'Entregada · saldo pendiente' if status == 'Completa' else 'Saldo pendiente'})
    return sorted(events, key=lambda e: e['date'])


@router.get('/calendar/unscheduled-collections')
def unscheduled_collections(user=Depends(current_user), db=Depends(get_db, scope='function')):
    if not (can(db, user, 'finance') or can(db, user, 'attention')):
        return []
    pending = []
    for case in db.scalars(select(Case).where(visibility(db, user))):
        client = db.get(Client, case.client_id)
        for production in db.scalars(select(Production).where(Production.case_id == case.id, Production.cancelled_at.is_(None))):
            order_balance = balance(db, case.id, production.id)['balance']
            if order_balance is None or Decimal(order_balance) <= 0:
                continue
            scheduled = db.scalar(select(Task.id).where(Task.case_id == case.id, Task.production_id == production.id,
                Task.purpose == 'COLLECTION', Task.done_at.is_(None)).limit(1))
            if scheduled:
                continue
            pending.append({'id': production.id, 'case_id': case.id, 'case_number': f'CG-{case.id:06d}',
                'client': client.name if client else case.subject, 'order_number': f'OP-{production.id:05d}',
                'title': production.payment_terms, 'status_label': 'Falta programar el seguimiento de cobro',
                'delivered': delivery_status(db, case.id, production.id) == 'Completa'})
    return pending


@router.get('/indicators')
def indicators(user=Depends(current_user), db=Depends(get_db, scope='function')):
    require(db, user, 'reports')
    def count(query):
        return db.scalar(select(func.count()).select_from(query.order_by(None).subquery())) or 0

    can_see_finances = can(db, user, 'finance') or can(db, user, 'attention')
    production_query = _order_query(db, user, 'production')
    ready_query = _order_query(db, user, 'ready')
    stages = {STAGE_LABELS.get(stage, 'Sin clasificar'): count(production_query.where(Production.stage == stage))
              for stage in (None, 'NEW', 'APPROVAL', 'PRINTING', 'WORKSHOP')}
    ready = count(ready_query)
    late = orders_count(db, user, 'late')
    result = {
        'current': {
            'unassigned_cases': count(case_query(db, user, {'view': 'pool'})),
            'action_cases': count(case_query(db, user, {'view': 'action'})),
            'production_by_stage': stages, 'late_orders': late, 'ready_orders': ready,
        },
        'pickup': {}, 'collection': None,
        'period': {'from': str(today() - timedelta(days=29)), 'through': str(today())},
    }
    oldest_ready = db.execute(ready_query.order_by(None).order_by(Production.stage_started_at, Production.id).limit(5)).all()
    result['oldest_ready'] = [{'id': order.id, 'case_id': case.id,
                               'days': max(0, (now() - order.stage_started_at).days)}
                              for order, case, _client in oldest_ready]
    if can_see_finances:
        result['pickup'] = {
            'unpaid': count(_order_query(db, user, 'ready', {'pickup': 'unpaid'})),
            'partial': count(_order_query(db, user, 'ready', {'pickup': 'partial'})),
            'paid': count(_order_query(db, user, 'ready', {'pickup': 'paid'})),
        }
        collection_tasks = select(Task.id).join(Case, Case.id == Task.case_id).where(
            visibility(db, user), Case.lifecycle == 'Activo', Task.purpose == 'COLLECTION', Task.done_at.is_(None))
        result['collection'] = {
            'delivered_pending': orders_count(db, user, 'delivered-balances'),
            'delivered_overdue': orders_count(db, user, 'delivered-overdue'),
            'followups_pending': count(collection_tasks),
            'followups_overdue': count(collection_tasks.where(Task.due_at < now())),
        }
    # Entregas completas del período: una fila por OP y último instante real.
    _has_item, _remaining_item, complete = order_item_predicates()
    period_start = today() - timedelta(days=29)
    local_zone = ZoneInfo(settings.app_timezone)
    utc_start = datetime.combine(period_start, time.min, local_zone).astimezone(timezone.utc).replace(tzinfo=None)
    utc_end = datetime.combine(today() + timedelta(days=1), time.min, local_zone).astimezone(timezone.utc).replace(tzinfo=None)
    last_delivery = func.max(Delivery.delivered_at)
    completed = db.execute(select(Production.id, Production.original_committed_date, last_delivery)
        .join(Case, Case.id == Production.case_id)
        .join(Item, Item.production_id == Production.id)
        .join(Delivery, Delivery.item_id == Item.id)
        .where(visibility(db, user), Production.cancelled_at.is_(None), complete)
        .group_by(Production.id, Production.original_committed_date)
        .having(last_delivery >= utc_start, last_delivery < utc_end)).all()
    within_period = [(original, delivered) for _id, original, delivered in completed
                     if period_start <= local_day(delivered) <= today()]
    measured = [(original, delivered) for original, delivered in within_period if original]
    result['compliance'] = {
        'numerator': sum(local_day(delivered) <= original for original, delivered in measured),
        'denominator': len(measured), 'without_original_date': len(within_period) - len(measured),
    }
    return result
