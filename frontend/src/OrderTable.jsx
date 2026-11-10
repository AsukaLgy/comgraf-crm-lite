import { Link, useLocation } from 'react-router-dom'
import { date, formatDateTime, money } from './api'
import { Badge, Empty } from './components'

export default function OrderTable({ items, showBalance = false }) {
  const location = useLocation()
  const context = `from=${encodeURIComponent(location.pathname)}&return=${encodeURIComponent(location.pathname + location.search)}`
  if (!items?.length) return <Empty>No hay órdenes en esta vista.</Empty>
  return (
    <div
      className="table-wrap inbox-list-scroll"
      tabIndex={0}
      role="region"
      aria-label="Lista desplazable de órdenes de producción"
    >
      <table className="case-table">
        <thead>
          <tr>
            <th>Orden / solicitud</th>
            <th>Cliente</th>
            <th>Etapa actual</th>
            <th>Entrega comprometida</th>
            <th>Productos pendientes</th>
            {showBalance && <th>Saldo</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((order) => (
            <tr key={order.id}>
              <td>
                <Link to={`/cases/${order.case_id}?production_id=${order.id}&${context}`}>
                  <small className="case-number">{order.case_number}</small>
                  <strong>{order.order_number}</strong>
                  <small>{order.subject}</small>
                </Link>
              </td>
              <td>{order.client.name}</td>
              <td>
                <Badge
                  tone={order.blocked_since ? 'red' : order.stage === 'READY' ? 'amber' : 'teal'}
                >
                  {order.blocked_since ? 'Bloqueada · ' : ''}
                  {order.stage_label}
                </Badge>
                {order.blocked_since && order.block_reason && <small>{order.block_reason}</small>}
              </td>
              <td>
                {order.committed_date ? date(order.committed_date) : 'Sin fecha'}
                <small>
                  {order.scheduled_at ? `Inicio ${formatDateTime(order.scheduled_at)}` : ''}
                </small>
              </td>
              <td>
                {order.pending_quantities.length
                  ? order.pending_quantities.map((item, index) => (
                      <small key={index}>
                        {item.product}: {item.quantity} {item.unit}
                      </small>
                    ))
                  : 'Entregada'}
              </td>
              {showBalance && (
                <td>
                  {order.balance === undefined
                    ? '—'
                    : order.balance === null
                      ? 'Revisión por moneda'
                      : money(order.balance, order.currency)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
