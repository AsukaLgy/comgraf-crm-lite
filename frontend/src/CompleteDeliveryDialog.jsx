import { useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, money, uid, date, localDate } from './api'
import { Field, FormDialog, RadioGroup, Select } from './components'
import { DEFAULT_DELIVERY_METHOD, DELIVERY_METHOD_OPTIONS } from './domain'

export default function CompleteDeliveryDialog({
  record,
  orders,
  financial,
  canCollect,
  onClose,
  onCompleted,
}) {
  const qc = useQueryClient()
  const key = useRef(uid())
  const signature = useRef(null)
  const first = orders.find((order) => order.id === record.production?.id) || orders[0]
  async function save(values) {
    const selected = orders.find((order) => String(order.id) === String(values.production_id))
    if (financial && selected?.balance === null)
      throw new Error('El saldo requiere revisión de moneda antes de entregar.')
    const pending = Number(selected?.balance || 0)
    const paying = canCollect && pending > 0 && values.collection === 'now'
    const amount = paying ? Number(values.payment_amount) : 0
    if (paying && (!Number.isFinite(amount) || amount <= 0 || amount > pending)) {
      throw new Error('El cobro debe ser positivo y no superar el saldo de la OP.')
    }
    if (paying && !values.payment_reference.trim())
      throw new Error('Indica la referencia del cobro.')
    const remaining = pending - amount
    const credit =
      selected?.payment_terms === 'Crédito' &&
      selected?.payment_due_date &&
      selected.payment_due_date >= localDate()
    if (financial && remaining > 0 && !credit && !values.balance_reason.trim()) {
      throw new Error('Indica un motivo breve para entregar con saldo pendiente.')
    }
    const body = {
      production_id: Number(values.production_id),
      method: values.method,
      receiver: values.receiver || '',
      evidence: values.evidence || '',
      ...(paying
        ? {
            payment_amount: values.payment_amount,
            payment_reference: values.payment_reference.trim(),
          }
        : {}),
      ...(!credit && values.balance_reason.trim()
        ? { balance_reason: values.balance_reason.trim() }
        : {}),
    }
    const next = JSON.stringify(body)
    if (signature.current !== null && signature.current !== next) key.current = uid()
    signature.current = next
    try {
      const result = await api(`/cases/${record.id}/deliveries/complete`, {
        method: 'POST',
        body: { ...body, version: record.version, key: key.current },
      })
      onCompleted?.(result)
      await qc.invalidateQueries()
    } catch (error) {
      if (error.status === 409)
        await qc.invalidateQueries({ queryKey: ['case', String(record.id)] })
      throw error
    }
  }
  return (
    <FormDialog
      wide
      title="Registrar entrega de OP completa"
      onClose={onClose}
      onSave={save}
      initial={{
        production_id: String(first.id),
        method: DEFAULT_DELIVERY_METHOD,
        receiver: '',
        evidence: '',
        collection: canCollect && first.payment_terms !== 'Crédito' ? 'now' : 'later',
        payment_amount: first.balance || '',
        payment_reference: '',
        balance_reason: '',
      }}
      submit={(values) => {
        const balance = orders.find(
          (order) => String(order.id) === String(values.production_id),
        )?.balance
        return !financial
          ? 'Registrar entrega'
          : balance !== null && Number(balance) <= 0
            ? 'Registrar entrega (pagado)'
            : canCollect && Number(values.payment_amount) > 0 && values.collection === 'now'
              ? 'Entregar y registrar cobro'
              : 'Registrar entrega con saldo pendiente'
      }}
      render={(values, set) => {
        const selected =
          orders.find((order) => String(order.id) === String(values.production_id)) || first
        const pending = Number(selected.balance || 0)
        const paid = financial && selected.balance !== null && pending <= 0
        const credit =
          selected.payment_terms === 'Crédito' &&
          selected.payment_due_date &&
          selected.payment_due_date >= localDate()
        const collecting = canCollect && pending > 0 && values.collection === 'now'
        const remaining = pending - (collecting ? Number(values.payment_amount || 0) : 0)
        return (
          <>
            {orders.length > 1 && (
              <Select
                label="Orden que se entregará"
                options={orders.map((order) => ({
                  value: String(order.id),
                  label: `${order.order_number} · ${order.description || 'Trabajo'}`,
                }))}
                value={values.production_id}
                onChange={(event) => {
                  const next = orders.find((order) => String(order.id) === event.target.value)
                  set('production_id', event.target.value)
                  set('payment_amount', next.balance || '')
                  set(
                    'collection',
                    canCollect && next.payment_terms !== 'Crédito' ? 'now' : 'later',
                  )
                  set('balance_reason', '')
                }}
              />
            )}
            <p className="notice">
              Se entregará completa {selected.order_number}. La fecha y hora se guardarán
              automáticamente.
            </p>
            <div className="form-grid">
              <RadioGroup
                label="Modalidad de entrega"
                required
                options={DELIVERY_METHOD_OPTIONS}
                value={values.method}
                onChange={(value) => set('method', value)}
              />
              <Field
                label="Recibido por (opcional)"
                value={values.receiver}
                onChange={(event) => set('receiver', event.target.value)}
              />
              <Field label="Evidencia / referencia (opcional)" className="full">
                <textarea
                  value={values.evidence}
                  onChange={(event) => set('evidence', event.target.value)}
                />
              </Field>
            </div>
            {financial ? (
              <section className="integrated-create-section">
                <h3>Cobro de {selected.order_number}</h3>
                <div className="finance-summary">
                  <div>
                    <small>Total de la orden</small>
                    <strong>{money(selected.price, selected.currency)}</strong>
                  </div>
                  <div>
                    <small>Pagos registrados</small>
                    <strong>{money(selected.payments_received, selected.currency)}</strong>
                  </div>
                  <div>
                    <small>Saldo pendiente</small>
                    <strong>{money(selected.balance, selected.currency)}</strong>
                  </div>
                </div>
                <p>
                  Condición: <strong>{selected.payment_terms}</strong>
                  {selected.payment_due_date && (
                    <> · Vencimiento: {date(selected.payment_due_date)}</>
                  )}
                </p>
                {selected.balance === null ? (
                  <p className="notice">
                    Saldo en revisión de moneda. Resuelve la diferencia antes de entregar.
                  </p>
                ) : paid ? (
                  <p className="notice">Pagado. No se registrará otro cobro.</p>
                ) : (
                  <>
                    {canCollect ? (
                      <Select
                        label="Cobro al entregar"
                        options={[
                          { value: 'now', label: 'Cobrar ahora' },
                          {
                            value: 'later',
                            label: credit ? 'Entregar a crédito' : 'Entregar sin cobrar ahora',
                          },
                        ]}
                        value={values.collection}
                        onChange={(event) => set('collection', event.target.value)}
                      />
                    ) : (
                      <p className="notice">
                        {credit ? 'Entregar a crédito' : 'Entregar sin cobrar ahora'}. El cobro
                        requiere autorización financiera.
                      </p>
                    )}
                    {collecting && (
                      <div className="form-grid">
                        <Field
                          label="Importe a cobrar (HNL)"
                          type="number"
                          min="0.01"
                          step="0.01"
                          required
                          value={values.payment_amount}
                          onChange={(event) => set('payment_amount', event.target.value)}
                        />
                        <Field
                          label="Referencia / comprobante"
                          required
                          value={values.payment_reference}
                          onChange={(event) => set('payment_reference', event.target.value)}
                        />
                      </div>
                    )}
                    <p>
                      Saldo después de entregar:{' '}
                      <strong>{money(Math.max(0, remaining), selected.currency)}</strong>
                    </p>
                    {remaining > 0 &&
                      (credit ? (
                        <p className="notice">Motivo: Crédito acordado.</p>
                      ) : (
                        <Field label="Motivo del saldo pendiente" required>
                          <textarea
                            maxLength={300}
                            value={values.balance_reason}
                            onChange={(event) => set('balance_reason', event.target.value)}
                          />
                        </Field>
                      ))}
                  </>
                )}
              </section>
            ) : (
              <section className="integrated-create-section">
                <h3>Entrega sin cobro</h3>
                <p>Los importes están restringidos. Si queda saldo, explica por qué se entrega.</p>
                <Field label="Motivo del saldo pendiente (si corresponde)">
                  <textarea
                    maxLength={300}
                    value={values.balance_reason}
                    onChange={(event) => set('balance_reason', event.target.value)}
                  />
                </Field>
              </section>
            )}
          </>
        )
      }}
    />
  )
}
