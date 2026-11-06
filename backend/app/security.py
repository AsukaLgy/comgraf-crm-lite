import hashlib
import secrets
from datetime import timedelta
from contextlib import contextmanager
from fastapi import Depends, HTTPException, Request, Response
from pwdlib import PasswordHash
from sqlalchemy import select
from .db import get_db
from .models import User, Role, Session, now
from .config import settings

passwords = PasswordHash.recommended()
DUMMY_HASH = passwords.hash(secrets.token_urlsafe(24))
DEFAULT_ROLES = {
    'Administrador': ['*'],
    'Coordinador': ['read_all', 'attention', 'assign', 'reopen', 'production', 'finance', 'adjust', 'clients', 'reports', 'partial_release_approve'],
    'Atención': ['attention', 'clients'],
    'Producción': ['production'],
    'Cobranza': ['finance', 'reports'],
    'Escáner de encuadernación': ['binding_scan'],
}
PERMISSIONS = sorted({p for values in DEFAULT_ROLES.values() for p in values})
_PERMISSION_CACHE_KEY = '_comgraf_permission_snapshot'
SESSION_COOKIE_DAYS = 365


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def permissions(db, user):
    snapshot = db.info.get(_PERMISSION_CACHE_KEY)
    identity = (user.id, tuple(user.roles or ()))
    if snapshot and snapshot[0] == identity:
        return snapshot[1]
    return {p for role in db.scalars(select(Role).where(Role.name.in_(user.roles))) for p in role.permissions}


@contextmanager
def cached_permissions(db, user):
    """Reuse a user's role lookup during one read-only aggregate operation."""
    identity = (user.id, tuple(user.roles or ()))
    previous = db.info.get(_PERMISSION_CACHE_KEY)
    available = permissions(db, user)
    db.info[_PERMISSION_CACHE_KEY] = (identity, available)
    try:
        yield available
    finally:
        if previous is None:
            db.info.pop(_PERMISSION_CACHE_KEY, None)
        else:
            db.info[_PERMISSION_CACHE_KEY] = previous


def can(db, user, permission):
    available = permissions(db, user)
    return '*' in available or permission in available


def require(db, user, permission):
    if not can(db, user, permission):
        raise HTTPException(403, 'No tienes permiso para esta operación')


def require_binding_scanner(db, user):
    if user.roles != ['Escáner de encuadernación'] or not can(db, user, 'binding_scan'):
        raise HTTPException(403, 'Esta operación requiere el rol Escáner de encuadernación')


def current_user(request: Request, response: Response, db=Depends(get_db, scope='function')):
    raw = request.cookies.get('comgraf_session', '')
    session = db.get(Session, digest(raw)) if raw else None
    if session and session.generation != request.app.state.session_generation:
        raise HTTPException(401, 'El servicio se reinició. Inicia sesión nuevamente')
    if not session or session.expires_at < now():
        raise HTTPException(401, 'Inicia sesión para continuar')
    user = db.get(User, session.user_id)
    if not user or not user.active:
        raise HTTPException(401, 'Cuenta desactivada')
    if 'Escáner de encuadernación' in user.roles:
        allowed = request.url.path in {'/api/auth/me', '/api/auth/logout'} or request.url.path.startswith('/api/scanner/')
        if user.roles != ['Escáner de encuadernación'] or not allowed:
            raise HTTPException(403, 'Esta cuenta está limitada a la terminal de escaneo')
    # The browser keeps a persistent cookie, while this rolling technical expiry
    # is refreshed on use. Service generation and account revocation are decisive.
    session.expires_at = now() + timedelta(days=SESSION_COOKIE_DAYS)
    response.set_cookie('comgraf_session', raw, httponly=True, samesite='strict',
                        secure=settings.cookie_secure, max_age=SESSION_COOKIE_DAYS * 86400)
    return user


def user_data(db, user):
    return {'id': user.id, 'username': user.username, 'name': user.name,
            'roles': user.roles, 'active': user.active, 'capacity': user.capacity,
            'permissions': sorted(permissions(db, user)),
            'timezone': settings.app_timezone}
