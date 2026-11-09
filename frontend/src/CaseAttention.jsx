import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Printer, UserRound, Pencil } from 'lucide-react'
import { date } from './api'
import { Badge, ErrorBox } from './components'

export default function CaseAttention({
  record,
  onEditTitle,
  person,
  canAttend,
  canTake,
  canAssign,
  onTake,
  onAssign,
  onConvert,
  onToggle,
  attentionError,
  attentionBusy,
  onRefresh,
  onEdit,
  onComplete,
  onReactivate,
  canComplete,
  completionBusy,
  canReactivate,
}) {
  return (
    <>
      <section className="case-heading">
        <div>
          <div className="eyebrow">
            SOLICITUD {record.number}{' '}
            <Badge tone={record.production_count ? 'teal' : ''}>{record.production_count ? `${record.production_count} órdenes` : record.mode}</Badge>
            {record.lifecycle === 'Completado' && <Badge tone="teal">Completado</Badge>}
          </div>
          <EditableTitle record={record} onSave={onEditTitle}/>
          <div className="case-meta">
            <span>{record.client.name}</span>
            <span>· Responsable: {person(record.owner_id)}</span>
            <span>· {record.kind === 'Solicitud' ? 'Orden de producción' : record.kind}</span>
            {record.channel && <span>· {record.channel}</span>}
            <span>· {date(record.created_at)}</span>
          </div>
        </div>
        <div className="actions">
          {!record.owner_id && canTake && (
            <button className="primary" onClick={onTake}>
              <UserRound size={15} />
              Tomar solicitud
            </button>
          )}
          {canAssign && <button onClick={onAssign}>Asignar solicitud</button>}
          {canAttend && !record.production_count && (
            <button className="primary" onClick={onConvert}>
              <Plus size={16} />
              Generar orden de producción
            </button>
          )}
          {canAttend && (
            <button onClick={onToggle} disabled={attentionBusy}>
              {record.status === 'Cerrado' ? 'Abrir atención' : 'Cerrar atención'}
            </button>
          )}
          {canAttend && record.lifecycle !== 'Completado' && (
            <button
              onClick={onComplete}
              disabled={completionBusy}
              title={
                !canComplete ? 'Revisa los pendientes para ver qué falta resolver.' : undefined
              }
            >
              Completar solicitud
            </button>
          )}
          {canReactivate && record.lifecycle === 'Completado' && (
            <button className="primary" onClick={onReactivate} disabled={completionBusy}>
              Reactivar solicitud
            </button>
          )}
          {record.production && (
            <Link className="button" to={`/cases/${record.id}/print?production_id=${record.production.id}`}>
              <Printer size={16} />
              Imprimir orden de producción
            </Link>
          )}
        </div>
      </section>
      <div className="status-strip">
        {record.lifecycle === 'Completado' && (
          <span>
            Completado {date(record.completed_at)} · {person(record.completed_by_id)}
          </span>
        )}
        <Badge>{record.status}</Badge>
        <Badge tone={record.priority === 'Urgente' ? 'red' : ''}>{record.priority}</Badge>
        <span>
          Atención: <strong>{person(record.owner_id)}</strong>
        </span>
        {record.production_count > 0 && (
          <>
            <span><strong>{record.production_count} órdenes · {record.production_pending_count} pendientes</strong></span>
            {record.payment_status && (
              <span>
                Pago:{' '}
                <Badge
                  tone={
                    record.payment_status === 'Vencido'
                      ? 'red'
                      : record.payment_status === 'Pagado'
                        ? 'teal'
                        : ''
                  }
                >
                  {record.payment_status}
                </Badge>
              </span>
            )}
          </>
        )}
        {canAttend && <button onClick={onEdit}>Editar datos de la solicitud</button>}
        {record.related_case_id && (
          <Link to={`/cases/${record.related_case_id}`}>Solicitud relacionada</Link>
        )}
        <span className="muted">Revisión {record.version}</span>
        <button className="text-button" onClick={onRefresh}>
          Actualizar
        </button>
      </div>
      {canAttend && (
        <p className="muted">
          Cerrar atención retira la solicitud de pendientes inmediatos; el trabajo y sus cobros
          continúan.
        </p>
      )}
      <ErrorBox error={attentionError} />
    </>
  )
}

function EditableTitle({record,onSave}) {
  const [editing,setEditing]=useState(false),[value,setValue]=useState(record.subject),[busy,setBusy]=useState(false),[error,setError]=useState('')
  function cancel(){setValue(record.subject);setError('');setEditing(false)}
  async function save(){
    const title=value.trim()
    if(!title){setError('Escribe un título.');return}
    if(title.length>240){setError('El título no puede superar 240 caracteres.');return}
    if(busy)return
    setBusy(true);setError('')
    try{await onSave(title);setEditing(false)}catch(failure){setError(failure.message)}finally{setBusy(false)}
  }
  return editing?<div className="case-title-edit"><input aria-label="Título de la solicitud" autoFocus maxLength={240} value={value} onChange={e=>setValue(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void save()}if(e.key==='Escape')cancel()}}/><button type="button" disabled={busy} onClick={()=>void save()}>{busy?'Guardando…':'Guardar'}</button><button type="button" disabled={busy} onClick={cancel}>Cancelar</button>{error&&<small role="alert">{error}</small>}</div>:<div className="case-title-line"><h1>{record.subject}</h1><button type="button" className="text-button" onClick={()=>{setValue(record.subject);setEditing(true)}}><Pencil size={14}/>Editar título</button></div>
}
