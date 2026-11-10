import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { Badge } from './components'
import {
  PRODUCTION_STAGES,
  PRODUCTION_STAGE_LABELS,
  PRODUCTION_STAGE,
  PRODUCTION_NEXT_STAGE,
} from './domain'

const reason = { name: 'reason', label: 'Motivo del reclamo', type: 'textarea', required: true }

export default function ProductionStages({
  record,
  canManage,
  isAdmin,
  onAdminStage,
  onAdvanceStage,
  onRefresh,
  onSelectProduction,
  onConfirmFinished,
  confirmBusy,
  onSchedule,
  onDelivery,
  operation,
}) {
  const [stageBusy, setStageBusy] = useState(false),
    [stageError, setStageError] = useState(''),
    [stageMessage, setStageMessage] = useState('')
  const changing = useRef(false)
  const production = record.production
  const currentIndex = PRODUCTION_STAGES.indexOf(production.stage)
  const next = PRODUCTION_NEXT_STAGE[production.stage]
  const previous = currentIndex > 0 ? PRODUCTION_STAGES.slice(0, currentIndex) : []
  const confirmed = Boolean(
    production.binding_confirmed_at &&
    production.binding_confirmed_cycle === production.workflow_cycle,
  )
  const finishingStage = [PRODUCTION_STAGE.PRINTING, PRODUCTION_STAGE.WORKSHOP].includes(
    production.stage,
  )
  const canConfirm =
    canManage &&
    finishingStage &&
    !confirmed &&
    !production.classification_required &&
    !production.cancelled_at &&
    !production.blocked_since &&
    record.delivery_status !== 'Completa'
  const pendingOrders =
    confirmed && finishingStage
      ? record.productions.filter(
          (order) =>
            order.id !== production.id &&
            !order.cancelled_at &&
            order.stage !== PRODUCTION_STAGE.READY &&
            order.delivery_status !== 'Completa' &&
            !(
              order.binding_confirmed_at &&
              !order.blocked_since &&
              order.binding_confirmed_cycle === order.workflow_cycle &&
              [PRODUCTION_STAGE.PRINTING, PRODUCTION_STAGE.WORKSHOP].includes(order.stage) &&
              !order.classification_required
            ),
        )
      : []
  const visited = new Set([production.stage])
  useEffect(() => {
    if (!stageMessage) return undefined
    const timeout = window.setTimeout(() => setStageMessage(''), 2500)
    return () => window.clearTimeout(timeout)
  }, [stageMessage])
  function unavailableReason(stage) {
    if (stage === production.stage) return 'Etapa actual; no se registrará otro cambio.'
    if (!canManage) return 'No tienes permiso para cambiar esta OP.'
    if (production.cancelled_at) return 'La OP está anulada.'
    if (production.blocked_since) return 'Resuelve el bloqueo antes de cambiar la etapa.'
    if (record.delivery_status !== 'Pendiente') return 'La OP tiene entregas registradas.'
    if (production.classification_required && !isAdmin)
      return 'Clasifica la etapa histórica antes de continuar.'
    if (isAdmin) return ''
    if (stage === PRODUCTION_STAGE.READY)
      return 'Confirma el trabajo terminado con el QR o en el CRM; se aplicarán las reglas del grupo.'
    if (stage !== next && !previous.includes(stage))
      return 'Solo puedes avanzar a la etapa siguiente o registrar un reclamo a una etapa anterior.'
    return ''
  }
  async function chooseStage(stage) {
    if (changing.current || unavailableReason(stage)) return
    if (!isAdmin && previous.includes(stage)) {
      operation(
        'production/stage',
        `Registrar reclamo hacia ${PRODUCTION_STAGE_LABELS[stage]}`,
        [reason],
        { stage },
        undefined,
        'Registrar reclamo',
      )
      return
    }
    changing.current = true
    setStageBusy(true)
    setStageError('')
    setStageMessage('Guardando etapa…')
    try {
      await (isAdmin ? onAdminStage(stage) : onAdvanceStage(stage))
      setStageMessage('Etapa guardada')
    } catch (error) {
      setStageError(error.message)
      setStageMessage('')
      await onRefresh?.()
    } finally {
      changing.current = false
      setStageBusy(false)
    }
  }
  for (const event of record.events || []) {
    if (
      event.data?.production_id !== production.id &&
      !(record.production_count === 1 && !event.data?.production_id)
    )
      continue
    if (event.data?.action === 'converted' && event.data.stage) visited.add(event.data.stage)
    if (event.data?.action === 'stage' || event.data?.action === 'stage_classified') {
      if (event.data.from) visited.add(event.data.from)
      if (event.data.to || event.data.stage) visited.add(event.data.to || event.data.stage)
    }
  }

  function classify() {
    operation(
      'production/stage',
      'Clasificar etapa histórica',
      [
        {
          name: 'stage',
          label: 'Etapa física actual',
          options: PRODUCTION_STAGES.map((value) => ({
            value,
            label: PRODUCTION_STAGE_LABELS[value],
          })),
          required: true,
        },
      ],
      { stage: PRODUCTION_STAGE.NEW },
    )
  }

  return (
    <section className="production-path">
      <div className="production-path-header">
        <div className="production-path-identity">
          <small>ORDEN SELECCIONADA</small>
          <strong>{production.order_number}</strong>
          <span>{production.stage_label || 'Pendiente de clasificación'}</span>
        </div>
        {record.productions.length > 1 && (
          <label className="production-order-picker">
            <span>Cambiar OP</span>
            <select
              aria-label="Orden de producción seleccionada"
              value={production.id}
              disabled={stageBusy}
              onChange={(event) => onSelectProduction(Number(event.target.value))}
            >
              {record.productions.map((order) => (
                <option key={order.id} value={order.id}>
                  {order.order_number} · {order.stage_label || 'Pendiente de clasificación'}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <ol aria-label={`Etapas de producción de ${production.order_number}`}>
        {PRODUCTION_STAGES.map((stage, index) => {
          const reasonUnavailable = unavailableReason(stage)
          return (
            <li
              key={stage}
              className={stage === production.stage ? 'current' : visited.has(stage) ? 'done' : ''}
            >
              <button
                type="button"
                className="stage-step"
                disabled={Boolean(reasonUnavailable) || stageBusy}
                title={
                  reasonUnavailable ||
                  `Cambiar ${production.order_number} a ${PRODUCTION_STAGE_LABELS[stage]}`
                }
                aria-label={`${PRODUCTION_STAGE_LABELS[stage]} de ${production.order_number}. ${reasonUnavailable || 'Cambiar etapa.'}`}
                aria-current={stage === production.stage ? 'step' : undefined}
                onClick={() => chooseStage(stage)}
              >
                <span>
                  {visited.has(stage) && stage !== production.stage ? (
                    <Check size={13} />
                  ) : (
                    index + 1
                  )}
                </span>
                {PRODUCTION_STAGE_LABELS[stage]}
              </button>
            </li>
          )
        })}
      </ol>
      {(stageMessage || stageError) && (
        <div className="stage-feedback" role={stageError ? 'alert' : 'status'}>
          {stageError || stageMessage}
        </div>
      )}

      {production.classification_required && (
        <div className="notice">
          La etapa histórica «{production.legacy_stage}» no permite inferir la etapa física actual.
          Clasifícala explícitamente para continuar.
        </div>
      )}

      {production.cancelled_at ? (
        <div className={production.cancellation_review_pending ? 'notice' : 'error'}>
          Producción anulada.
          {production.cancellation_review_pending
            ? ' Resolución económica pendiente en Entregas y cobros.'
            : ' Consulta su situación económica en Entregas y cobros.'}
        </div>
      ) : (
        <div className="production-controls">
          <div className="production-status">
            {production.blocked_since && (
              <Badge tone="red">Bloqueado: {production.block_reason}</Badge>
            )}
            {production.classification_required ? (
              canManage && <button onClick={classify}>Clasificar etapa</button>
            ) : (
              <>
                {confirmed && finishingStage && (
                  <Badge tone="teal">Trabajo terminado confirmado</Badge>
                )}
                {!confirmed && finishingStage && !canConfirm && !production.blocked_since && (
                  <Badge tone="amber">Pendiente de confirmación</Badge>
                )}
                {production.stage === PRODUCTION_STAGE.READY && (
                  <Badge tone="teal">Listo para entregar</Badge>
                )}
                {record.delivery_status === 'Completa' && <Badge tone="teal">Entregado</Badge>}
                {production.active_elapsed_seconds != null && (
                  <small>
                    {Math.floor(production.active_elapsed_seconds / 3600)} h en etapa activa
                  </small>
                )}
                {pendingOrders.length > 0 && (
                  <span className="production-pending-orders">
                    Pendientes:{' '}
                    {pendingOrders.map((order) => (
                      <button
                        type="button"
                        className="text-button"
                        key={order.id}
                        onClick={() => onSelectProduction(order.id)}
                      >
                        {order.order_number}
                      </button>
                    ))}
                  </span>
                )}
              </>
            )}
          </div>
          {canManage &&
            !production.classification_required &&
            record.delivery_status !== 'Completa' && (
              <div className="actions">
                {canConfirm && (
                  <button className="primary" onClick={onConfirmFinished} disabled={confirmBusy}>
                    {confirmBusy ? 'Confirmando…' : 'Confirmar trabajo terminado'}
                  </button>
                )}
                <button onClick={onSchedule}>Programar</button>
                {production.stage === PRODUCTION_STAGE.READY ? (
                  <>
                    <button
                      className="primary"
                      onClick={onDelivery}
                      disabled={Boolean(production.blocked_since)}
                      title={
                        production.blocked_since
                          ? 'Resuelve el bloqueo antes de registrar entrega'
                          : undefined
                      }
                    >
                      Registrar entrega
                    </button>
                  </>
                ) : confirmed && finishingStage ? (
                  <small>La entrega se habilita al completar el grupo de órdenes.</small>
                ) : production.stage === PRODUCTION_STAGE.WORKSHOP ? (
                  <small>También puedes confirmar con el escáner QR.</small>
                ) : (
                  <small>
                    Selecciona una etapa disponible en la barra para avanzar o registrar un reclamo.
                  </small>
                )}
                <button
                  onClick={() =>
                    operation(
                      `production/${production.blocked_since ? 'unblock' : 'block'}`,
                      production.blocked_since ? 'Resolver bloqueo' : 'Bloquear trabajo',
                      [{ name: 'reason', label: 'Motivo', type: 'textarea', required: true }],
                    )
                  }
                >
                  {production.blocked_since ? 'Resolver bloqueo' : 'Bloquear'}
                </button>
              </div>
            )}
        </div>
      )}
    </section>
  )
}
