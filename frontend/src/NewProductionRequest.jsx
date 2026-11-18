import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, money, uid } from './api'
import { ErrorBox, Field, FormDialog, RadioGroup, Select } from './components'
import { ClientAutocomplete } from './NewCase'
import { ItemsEditor, cleanItems, newItem, validateFiscalDocumentTypes } from './ProductForm'
import {
  DEFAULT_DELIVERY_METHOD,
  DELIVERY_METHOD_OPTIONS,
  PAYMENT_TERMS,
  PAYMENT_TERM_OPTIONS,
} from './domain'

export default function NewProductionRequest({ user, onClose }) {
  const navigate = useNavigate(),
    qc = useQueryClient(),
    idempotency = useRef({ key: uid(), signature: '' }),
    [created, setCreated] = useState(null),
    [advancing, setAdvancing] = useState(false),
    [advanceError, setAdvanceError] = useState(null)
  const initial = {
    client_id: '',
    contact_id: '',
    subject: '',
    priority: 'Normal',
    description: '',
    items: [newItem()],
    requested_date: '',
    committed_date: '',
    payment_terms: PAYMENT_TERMS[0],
    advance_required: '0',
    payment_due_date: '',
    delivery_method: DEFAULT_DELIVERY_METHOD,
    instructions: '',
    quote_id: '',
  }
  const createdOrders = created?.productions?.length
    ? created.productions
    : created?.production
      ? [created.production]
      : []
  const multipleOrders = createdOrders.length > 1
  async function save(v) {
    if (!v.client_id) throw new Error('Selecciona un cliente antes de guardar.')
    if (!v.subject.trim()) throw new Error('Escribe el asunto de la solicitud.')
    if (!v.items.length) throw new Error('Agrega al menos un producto.')
    validateFiscalDocumentTypes(v.items)
    const body = {
      ...v,
      client_id: Number(v.client_id),
      contact_id: v.contact_id ? Number(v.contact_id) : null,
      priority: v.priority,
      currency: 'HNL',
      quote_id: null,
      items: cleanItems(v.items),
      requested_date: v.requested_date || null,
      committed_date: v.committed_date || null,
      advance_required: String(v.advance_required || '0'),
      payment_due_date: v.payment_due_date || null,
    }
    const signature = JSON.stringify(body)
    if (idempotency.current.signature && idempotency.current.signature !== signature)
      idempotency.current.key = uid()
    idempotency.current.signature = signature
    const result = await api('/production-requests', {
      method: 'POST',
      body: { ...body, version: 1, key: idempotency.current.key },
    })
    setCreated(result)
    void qc.invalidateQueries().catch(() => {})
    return false
  }
  async function finish(advance) {
    if (!created || advancing || (advance && createdOrders.length !== 1)) return
    if (advance) {
      setAdvancing(true)
      setAdvanceError(null)
      try {
        await api(`/cases/${created.id}/production/stage`, {
          method: 'POST',
          body: {
            production_id: createdOrders[0].id,
            stage: 'PRINTING',
            version: created.version,
            key: uid(),
          },
        })
        await qc.invalidateQueries()
      } catch (error) {
        setAdvanceError(error)
        setAdvancing(false)
        return
      }
    }
    navigate(`/cases/${created.id}?tab=production&production_id=${createdOrders[0].id}`)
    onClose()
  }
  return (
    <FormDialog
      wide
      title="Generar orden de producción"
      submit={(values) => `Crear solicitud y ${values.items.length > 1 ? 'órdenes' : 'orden'}`}
      initial={initial}
      onClose={onClose}
      onSave={save}
      afterSave={() => (
        <div className="dialog-body">
          <div className="notice">
            <strong>
              {multipleOrders
                ? `${createdOrders.length} órdenes creadas en Aprobación.`
                : 'Orden creada en Aprobación.'}
            </strong>
            {multipleOrders ? (
              <>
                <ul>
                  {createdOrders.map((order) => (
                    <li key={order.id}>
                      {order.order_number} · {(order.product_names || []).join(', ')}
                    </li>
                  ))}
                </ul>
                <small>Podrás avanzar cada orden por separado desde la solicitud.</small>
              </>
            ) : (
              <>
                <p>¿Querés pasarla a Impresión ahora?</p>
                <small>
                  Elegí esta opción si el trabajo ya está aprobado y comenzará a imprimirse.
                </small>
              </>
            )}
          </div>
          {!multipleOrders && (
            <p>{createdOrders[0]?.order_number} quedó guardada en la solicitud.</p>
          )}
          <ErrorBox error={advanceError} />
          <div className="actions">
            {multipleOrders ? (
              <button type="button" className="primary" onClick={() => finish(false)}>
                Ver órdenes
              </button>
            ) : (
              <>
                <button type="button" disabled={advancing} onClick={() => finish(false)}>
                  Mantener en Aprobación
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={advancing}
                  onClick={() => finish(true)}
                >
                  {advancing ? 'Actualizando…' : 'Pasar a Impresión'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
      render={(v, set) => (
        <>
          <section className="integrated-create-section">
            <h3>Cliente y solicitud</h3>
            <div className="form-grid">
              <ClientAutocomplete
                id="production-client"
                searchEndpoint="/production-clients"
                user={user}
                selectedId={v.client_id}
                onSelect={(client) => {
                  set('client_id', String(client.id))
                  set('contact_id', '')
                }}
                onClear={() => {
                  set('client_id', '')
                  set('contact_id', '')
                }}
              />
              <ProductionContactField
                clientId={v.client_id}
                value={v.contact_id}
                onChange={(value) => set('contact_id', value)}
              />
              <Field
                label="Asunto"
                required
                value={v.subject}
                onChange={(e) => set('subject', e.target.value)}
              />
              <Select
                label="Prioridad"
                options={['Baja', 'Normal', 'Alta', 'Urgente']}
                value={v.priority}
                onChange={(e) => set('priority', e.target.value)}
              />
              <Field label="Descripción (opcional)" className="full">
                <textarea
                  rows={3}
                  value={v.description}
                  onChange={(e) => set('description', e.target.value)}
                />
              </Field>
            </div>
          </section>
          <section className="integrated-create-section">
            <h3>Trabajo a producir</h3>
            <div className="notice">
              Cada producto genera una orden independiente; sus especificaciones y comentarios
              quedan asociados a esa orden.
            </div>
            <ItemsEditor items={v.items} onChange={(items) => set('items', items)} />
            <div className="form-grid">
              <Field
                label="Fecha solicitada"
                type="date"
                value={v.requested_date}
                onChange={(e) => set('requested_date', e.target.value)}
              />
              <Field
                label="Fecha comprometida"
                type="date"
                value={v.committed_date}
                onChange={(e) => set('committed_date', e.target.value)}
              />
              <RadioGroup
                label="Condición de pago"
                required
                options={PAYMENT_TERM_OPTIONS}
                value={v.payment_terms}
                onChange={(value) => set('payment_terms', value)}
              />
              <Field
                label="Anticipo recibido (HNL)"
                type="number"
                min="0"
                step="0.01"
                required
                value={v.advance_required}
                onChange={(e) => set('advance_required', e.target.value)}
              />
              <small className="full">
                Se registrará como abono al crear las órdenes y reducirá automáticamente el saldo pendiente.
              </small>
              {v.items.length > 1 && (
                <small className="full">
                  El anticipo total se distribuye proporcionalmente entre las órdenes.
                </small>
              )}
              <Field
                label="Vencimiento del saldo (si está acordado)"
                type="date"
                value={v.payment_due_date}
                onChange={(e) => set('payment_due_date', e.target.value)}
              />
              <RadioGroup
                label="Modalidad de entrega"
                required
                options={DELIVERY_METHOD_OPTIONS}
                value={v.delivery_method}
                onChange={(value) => set('delivery_method', value)}
              />
              <Field label="Instrucciones de taller" className="full">
                <textarea
                  rows={3}
                  value={v.instructions}
                  onChange={(e) => set('instructions', e.target.value)}
                />
              </Field>
            </div>
            <p className="total">
              Total estimado{' '}
              <strong>
                {money(
                  v.items.reduce(
                    (sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_price || 0),
                    0,
                  ),
                  'HNL',
                )}
              </strong>
            </p>
          </section>
        </>
      )}
    />
  )
}

function ProductionContactField({ clientId, value, onChange }) {
  const contacts = useQuery({
    queryKey: ['production-client-contacts', clientId],
    queryFn: () => api(`/production-clients/${clientId}/contacts`),
    enabled: Boolean(clientId),
  })
  return (
    <>
      <Select
        label="Contacto vinculado (opcional)"
        options={(contacts.data || []).map((contact) => ({
          value: String(contact.id),
          label: contact.name,
        }))}
        empty={clientId ? 'Sin contacto específico' : 'Selecciona un cliente primero'}
        value={value || ''}
        disabled={!clientId || contacts.isPending}
        onChange={(event) => onChange(event.target.value)}
      />
      <ErrorBox error={contacts.error} />
    </>
  )
}
