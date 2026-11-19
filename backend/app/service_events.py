"""Shared activity and case-lifecycle audit event helpers."""
from .models import Event, now


def event(db, case, user, body, kind='Sistema', channel='Sistema', data=None):
    db.add(Event(case_id=case.id, actor_id=user.id if user else None, body=body, kind=kind, channel=channel, data=data or {}))
    case.updated_at = now()


def finalize_case(db, case, actor_id, *, origin, action_trigger, regularization_run=None):
    """Persist one lifecycle transition and its audit event for every completion path."""
    if case.lifecycle != 'Activo':
        return False
    completed_at = now()
    old_status = case.status
    case.lifecycle = 'Completado'
    case.completed_at = completed_at
    case.completed_by_id = actor_id
    case.status = 'Cerrado'
    case.closed_at = completed_at
    body = 'Solicitud regularizada durante la actualización' if origin == 'historical_regularization' else 'Solicitud completada'
    db.add(Event(case_id=case.id, actor_id=actor_id, kind='Sistema', channel='Sistema',
        body=body, data={
            'action': 'case_completed', 'lifecycle_from': 'Activo', 'lifecycle_to': 'Completado',
            'attention_from': old_status, 'attention_to': 'Cerrado', 'origin': origin,
            'action_trigger': action_trigger,
            'regularization_run': regularization_run,
            'completed_at': completed_at.isoformat() + 'Z', 'actor_id': actor_id}))
    case.updated_at = completed_at
    return True
