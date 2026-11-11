import { date } from './api'
import { Badge } from './components'

export function orderProducts(order) {
  const names = order.product_names?.length
    ? order.product_names
    : (order.specs_snapshot?.items || order.approved_snapshot?.items || []).map(
        (item) => item.product,
      )
  return names.length ? names.join(' · ') : 'Productos históricos sin detalle'
}

export function orderSituation(order) {
  if (order.cancelled_at) return { label: 'Anulada', tone: 'red' }
  if (order.delivery_status === 'Completa') return { label: 'Entregada', tone: 'teal' }
  if (order.blocked_since) return { label: 'Bloqueada', tone: 'amber' }
  return { label: order.stage_label || 'Pendiente de clasificación', tone: '' }
}

export function OrderList({ caseId, orders, selectedId, onSelect }) {
  return (
    <div className="case-order-list" aria-label="Órdenes de producción de la solicitud">
      {orders.map((order) => {
        const selected = String(order.id) === String(selectedId)
        const situation = orderSituation(order)
        return (
          <article
            className={`case-order-entry${selected ? ' selected' : ''}`}
            key={order.id}
            aria-current={selected ? 'true' : undefined}
          >
            <div className="case-order-entry-main">
              <div className="case-order-entry-heading">
                <strong>{order.order_number}</strong>
                <Badge tone={situation.tone}>{situation.label}</Badge>
                {selected && <small>Seleccionada</small>}
              </div>
              <span>{orderProducts(order)}</span>
              {order.committed_date && <small>Compromiso: {date(order.committed_date)}</small>}
            </div>
            <div className="case-order-entry-actions">
              <button type="button" onClick={() => onSelect(order.id)}>
                Ver orden
              </button>
              <a
                className="button"
                href={`/cases/${caseId}/print?production_id=${order.id}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Imprimir ${order.order_number}`}
              >
                Imprimir
              </a>
            </div>
          </article>
        )
      })}
    </div>
  )
}

export function PrintOrderPicker({ orders, selectedId, onSelect, disabled = false }) {
  return (
    <label className="print-order-picker">
      <span>Orden de producción</span>
      <select
        aria-label="Orden de producción para imprimir"
        value={selectedId || ''}
        disabled={disabled}
        onChange={(event) => onSelect(event.target.value)}
      >
        {orders.map((order) => (
          <option key={order.id} value={order.id}>
            {order.order_number} · {orderProducts(order)} · {orderSituation(order).label}
          </option>
        ))}
      </select>
    </label>
  )
}
