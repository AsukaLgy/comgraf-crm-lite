import { Clock, MessageSquare } from 'lucide-react'
import { Link } from 'react-router-dom'
import { formatDateTime } from './api'
import { Badge, Empty, Panel } from './components'
import Composer from './Composer'

export default function CaseActivity({ record, attention, user, person, onReference }) {
  return (
    <Panel title="Bitácora y notas" action={<Badge>{record.events.length} eventos</Badge>}>
      {attention ? (
        <Composer key={record.id} record={record} user={user} />
      ) : (
        <div className="notice">
          {record.production_count ? `${record.production_count} órdenes de producción en esta solicitud. ` : 'Sin órdenes de producción. '}
          Las especificaciones y notas se conservan en el expediente.
        </div>
      )}
      {record.events.length ? (
        <ol className="timeline">
          {[...record.events].reverse().map((event) => {
            const orderId = event.data?.production_id || event.data?.order_id
            return <li key={event.id} className={event.kind === 'Sistema' ? 'system' : ''}>
              <span className="timeline-icon">
                {event.kind === 'Sistema' ? <Clock size={14} /> : <MessageSquare size={14} />}
              </span>
              <div>
                <div className="event-meta">
                  <strong>{event.kind}</strong>
                  <span>{event.channel !== 'Sistema' && event.channel}</span>
                  <span>{person(event.actor_id)}</span>
                  <time>{formatDateTime(event.created_at)}</time>
                </div>
                <p>{event.data?.action === 'stage' ? event.body.replace('Taller', 'Encuadernación') : event.body}</p>
                {orderId && event.data?.action !== 'converted' && (
                  <p className="event-references"><Link to={`/cases/${record.id}?production_id=${orderId}&tab=production`}>{event.data.order_number || `OP-${String(orderId).padStart(5,'0')}`}</Link></p>
                )}
                {event.data?.action === 'converted' && (
                  <p className="event-references">
                    {orderId ? (
                      <Link to={`/cases/${record.id}?production_id=${orderId}&tab=production`}>
                        Orden {event.data.order_number || `OP-${String(orderId).padStart(5, '0')}`}
                      </Link>
                    ) : <span>Orden {event.data.order_number || 'sin identificador'}</span>}
                    {event.data.quote_id &&
                    (record.quotes || []).some((q) => q.id === event.data.quote_id) ? (
                      <>
                        {' '}
                        ·{' '}
                        <Link
                          to={`/cases/${record.id}?${orderId ? `production_id=${orderId}&` : ''}tab=quotes#quote-${event.data.quote_id}`}
                          onClick={() => onReference?.(`quote-${event.data.quote_id}`)}
                        >
                          Cotización {event.data.quote_number}, versión {event.data.quote_version}
                        </Link>
                      </>
                    ) : event.data.quote_id ? (
                      <small> · Cotización no disponible o sin permiso</small>
                    ) : null}
                  </p>
                )}
                {event.data.direction && <small>{event.data.direction}{event.data.email_message_id ? ' · Correo electrónico' : ' · Registro manual'}</small>}
              </div>
            </li>
          })}
        </ol>
      ) : (
        <Empty />
      )}
      {record.email_messages?.length > 0 && <section className="historical-messages" aria-label="Mensajes históricos">
        <h3>Correos históricos vinculados</h3>
        <p className="muted">Estos mensajes son de solo lectura. El estado de los pendientes no ha cambiado.</p>
        {record.email_messages.map((message) => <article className="historical-message" key={message.id}>
          <div className="event-meta"><strong>Correo · {message.direction}</strong><span>{message.sender || 'Remitente no registrado'}</span><time>{formatDateTime(message.received_at || message.created_at)}</time></div>
          <p><strong>{message.subject || '(Sin asunto)'}</strong></p>
          {message.to?.length > 0 && <small>Para: {message.to.join(', ')}</small>}
          <p><small>Estado histórico: {message.status}</small></p>
          <pre className="historical-message-body">{message.body_text || '(Sin contenido de texto)'}</pre>
          {message.attachments?.length > 0 && <div className="email-event-attachments">{message.attachments.map((attachment) => <a key={attachment.id} href={`/api/mail/attachments/${attachment.id}`}>{attachment.filename}</a>)}</div>}
        </article>)}
      </section>}
    </Panel>
  )
}
