import { useQueryClient } from '@tanstack/react-query'
import { api, can, money, quantity } from './api'
import { Field, FormDialog, Operation } from './components'
import CompleteDeliveryDialog from './CompleteDeliveryDialog'
import ProductForm from './ProductForm'
import DeleteDialog from './DeleteDialog'
import { HNL_CURRENCY } from './domain'

export default function CaseDialogs({
  modal,
  record,
  user,
  finance,
  selectedProductionId,
  finishResult,
  setFinishResult,
  setFinishBusy,
  onClose,
  onSelectProduction,
  onCompletionNotice,
  onCompleteCase,
  onDeleted,
}) {
  const qc = useQueryClient()
  const c = record
  const p = c.production

  return (
    <>
      {modal?.type === 'operation' && (
        <Operation
          {...modal}
          record={c}
          onClose={onClose}
          onSaved={(result) => {
            if (result.lifecycle === 'Completado' && c.lifecycle !== 'Completado')
              onCompletionNotice(
                modal.path === 'payments'
                  ? 'Pago registrado. Solicitud completada automáticamente'
                  : 'Solicitud completada automáticamente',
              )
          }}
        />
      )}
      {modal?.type === 'complete_delivery' && (
        <CompleteDeliveryDialog
          record={c}
          orders={modal.orders}
          financial={finance || can(user, 'attention')}
          canCollect={finance}
          onClose={onClose}
          onCompleted={(result) => {
            if (result.lifecycle === 'Completado' && c.lifecycle !== 'Completado')
              onCompletionNotice('Entrega registrada. Solicitud completada automáticamente')
          }}
        />
      )}
      {modal?.type === 'confirm_finished' &&
        modal.caseId === c.id &&
        modal.productionId === p?.id &&
        modal.selectionKey === selectedProductionId && (
          <FormDialog
            title="Confirmar trabajo terminado"
            initial={{}}
            submit="Confirmar trabajo terminado"
            busyLabel="Confirmando…"
            onClose={onClose}
            onSave={async () => {
              setFinishBusy(true)
              try {
                const result = await api(`/cases/${modal.caseId}/production/confirm-finished`, {
                  method: 'POST',
                  body: { production_id: modal.productionId },
                })
                await Promise.all([
                  qc.invalidateQueries({ queryKey: ['case', String(modal.caseId)] }),
                  qc.invalidateQueries({ predicate: (query) => query.queryKey[0] !== 'case' }),
                ])
                setFinishResult(result)
                return false
              } finally {
                setFinishBusy(false)
              }
            }}
            render={() => (
              <p>
                ¿Confirmar que el trabajo de <strong>{modal.orderNumber}</strong> está físicamente
                terminado?
              </p>
            )}
            afterSave={() => (
              <div className="dialog-body" role="status">
                <p>{finishResult?.message}</p>
                {finishResult?.pending_orders?.length > 0 && (
                  <p>
                    Órdenes pendientes:{' '}
                    {finishResult.pending_orders.map((order) => order.order_number).join(', ')}.
                  </p>
                )}
                <button onClick={onClose}>Cerrar</button>
              </div>
            )}
          />
        )}
      {modal?.type === 'complete' && (
        <FormDialog
          title="Completar solicitud"
          initial={{}}
          submit="Completar solicitud"
          canSubmit={(c.completion_blockers || []).length === 0}
          onClose={onClose}
          onSave={onCompleteCase}
          render={() => (
            <div className="notice">
              <p>
                La solicitud dejará las bandejas activas y seguirá disponible en el historial de
                solicitudes y perfil del cliente.
              </p>
              {c.completion_blockers?.length > 0 ? (
                <>
                  <strong>Resuelve estos pendientes antes de completar:</strong>
                  <ul>
                    {c.completion_blockers.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p>Completar no modifica producción, entregas ni pagos.</p>
              )}
            </div>
          )}
        />
      )}
      {(modal?.type === 'quote' || modal?.type === 'convert') && (
        <ProductForm
          record={c}
          user={user}
          quote={modal.type === 'quote'}
          source={modal.source}
          onClose={onClose}
          onCreated={onSelectProduction}
        />
      )}
      {modal?.type === 'upload' && (
        <FormDialog
          title="Adjuntar archivo"
          initial={{ file: null, art_version: '' }}
          onClose={onClose}
          onSave={async (values) => {
            const form = new FormData()
            form.append('file', values.file)
            form.append('art_version', values.art_version)
            await api(`/cases/${c.id}/attachments`, { method: 'POST', body: form })
            await qc.invalidateQueries({ queryKey: ['case', String(c.id)] })
          }}
          render={(values, set) => (
            <>
              <Field
                label="Archivo"
                required
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.txt"
                onChange={(event) => set('file', event.target.files[0])}
              />
              <Field
                label="Versión del arte"
                placeholder="Ej. v1"
                value={values.art_version}
                onChange={(event) => set('art_version', event.target.value)}
              />
            </>
          )}
        />
      )}
      {modal?.type === 'delete' && (
        <DeleteDialog key={c.id} kind="case" id={c.id} onClose={onClose} onDeleted={onDeleted} />
      )}
    </>
  )
}

export function CancellationSummary({ record }) {
  const ledger = record.ledger || []
  const payments = ledger
    .filter((entry) => ['Anticipo', 'Abono', 'Reversión de pago'].includes(entry.kind))
    .reduce((sum, entry) => sum - Number(entry.amount), 0)
  const refunds = ledger
    .filter((entry) => entry.kind === 'Devolución')
    .reduce((sum, entry) => sum + Number(entry.amount), 0)
  const items = record.items || []
  return (
    <div className="notice">
      <strong>Resumen antes de anular</strong>
      <p>Etapa: {record.production.stage_label || 'Pendiente de clasificación'}</p>
      {items.map((item) => {
        const delivered = (record.deliveries || [])
          .filter((delivery) => delivery.item_id === item.id)
          .reduce((sum, delivery) => sum + Number(delivery.quantity), 0)
        return (
          <p key={item.id}>
            {item.product}: {quantity(delivered)} de {quantity(item.quantity)} {item.unit}{' '}
            entregados
          </p>
        )
      })}
      {record.balance !== undefined ? (
        <>
          <p>Pagos netos recibidos: {money(payments, record.production.currency)}</p>
          <p>Devoluciones ya registradas: {money(refunds, record.production.currency)}</p>
          <p>Saldo financiero actual: {money(record.balance, record.production.currency)}</p>
        </>
      ) : (
        <p>El resumen económico está restringido a usuarios con permisos financieros.</p>
      )}
      {record.production.currency === HNL_CURRENCY && (
        <p>El importe final acordado es el total definitivo, no un cargo adicional.</p>
      )}
    </div>
  )
}

export function CancellationPreview({ record, values }) {
  if (record.balance === undefined || !values.treatment) return null
  const chargeKinds = ['Obligación', 'Ajuste', 'Ajuste de anulación']
  const currentCharges = (record.ledger || [])
    .filter((entry) => chargeKinds.includes(entry.kind))
    .reduce((sum, entry) => sum + Number(entry.amount), 0)
  const finalAmount = values.treatment === 'SIN_CARGO' ? 0 : Number(values.final_amount)
  if (!Number.isFinite(finalAmount)) return null
  const adjustment = finalAmount - currentCharges
  const resultingBalance = Number(record.balance) + adjustment
  return (
    <div className="notice" aria-live="polite">
      <strong>Vista previa del resultado</strong>
      <p>Cargo neto definitivo: {money(finalAmount, record.production.currency)}</p>
      <p>Ajuste de anulación: {money(adjustment, record.production.currency)}</p>
      {resultingBalance > 0 ? (
        <p>Saldo por cobrar: {money(resultingBalance, record.production.currency)}</p>
      ) : resultingBalance < 0 ? (
        <p>Pendiente de devolución: {money(-resultingBalance, record.production.currency)}</p>
      ) : (
        <p>
          Saldo resultante: {money(0, record.production.currency)} · sin cobro ni devolución
          pendientes.
        </p>
      )}
      <small>
        La vista previa no registra una devolución. El servidor vuelve a calcular el ajuste al
        guardar.
      </small>
    </div>
  )
}
