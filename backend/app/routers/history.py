"""Read-only access to attachments of historical messages linked to a case."""
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from ..config import settings
from ..db import get_db
from ..models import MailAttachment, MailMessage
from ..repository import get_case
from ..security import current_user

router = APIRouter(prefix='/api', tags=['Historial'])


@router.get('/mail/attachments/{attachment_id}')
def download_mail_attachment(attachment_id: int, user=Depends(current_user), db=Depends(get_db, scope='function')):
    attachment = db.get(MailAttachment, attachment_id)
    if not attachment:
        raise HTTPException(404, 'Adjunto histórico no encontrado')
    message = db.get(MailMessage, attachment.message_id)
    if not message or not message.case_id:
        raise HTTPException(404, 'El mensaje no está vinculado a una solicitud')
    get_case(db, user, message.case_id)
    path = Path(settings.upload_dir) / attachment.storage_key
    if not path.is_file():
        raise HTTPException(404, 'Adjunto no disponible; revisa el respaldo de archivos')
    return FileResponse(path, media_type=attachment.mime, filename=attachment.filename,
                        headers={'X-Content-Type-Options': 'nosniff'})


@router.api_route('/mail/{path:path}', methods=['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])
@router.api_route('/cases/{case_id}/email/{path:path}', methods=['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])
def retired_communication(path: str, case_id: int | None = None):
    raise HTTPException(410, 'La mensajería fue retirada; solo se conserva el historial vinculado.')
