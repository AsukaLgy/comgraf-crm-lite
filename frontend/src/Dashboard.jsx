import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  ArrowUpRight,
  BellRing,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FilePlus2,
  Printer,
  TrendingUp,
} from 'lucide-react'
import { api, can } from './api'
import { ErrorBox, Loading } from './components'

const numberFormat = new Intl.NumberFormat('es-HN')
const shortDate = new Intl.DateTimeFormat('es-HN', { weekday: 'short', day: 'numeric' })
const dateTime = new Intl.DateTimeFormat('es-HN', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

function formatActivityTime(value) {
  if (!value) return 'Fecha no disponible'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? 'Fecha no disponible' : dateTime.format(date)
}

function activityTone(item) {
  if (item.action === 'created') return 'blue'
  if (item.action === 'converted') return 'indigo'
  if (item.action === 'stage' && item.body?.includes('READY')) return 'green'
  if (item.action === 'cancelled' || item.action === 'blocked') return 'amber'
  return 'slate'
}

function TrendChart({ points = [], days }) {
  const maxValue = Math.max(1, ...points.flatMap((point) => [point.requests, point.orders]))
  return (
    <div className="trend-plot" role="img" aria-label={`Actividad de solicitudes y órdenes de los últimos ${days} días`}>
      {points.map((point, index) => {
        const requestHeight = Math.max(3, (point.requests / maxValue) * 100)
        const orderHeight = Math.max(3, (point.orders / maxValue) * 100)
        const showLabel = days === 7 || index % 5 === 0 || index === points.length - 1
        const date = new Date(`${point.date}T12:00:00`)
        return (
          <div className="trend-day" key={point.date}>
            <div className="trend-bars">
              <span
                className="trend-bar trend-bar-requests"
                style={{ height: `${requestHeight}%` }}
                title={`${point.requests} solicitudes`}
              />
              <span
                className="trend-bar trend-bar-orders"
                style={{ height: `${orderHeight}%` }}
                title={`${point.orders} órdenes de producción`}
              />
            </div>
            <span className="trend-day-label">{showLabel ? shortDate.format(date) : ''}</span>
          </div>
        )
      })}
    </div>
  )
}

function ActivityFeed({ items = [] }) {
  if (!items.length) {
    return (
      <div className="activity-empty">
        <Clock3 size={19} />
        <span>Cuando haya movimientos, aparecerán aquí.</span>
      </div>
    )
  }

  return (
    <ol className="activity-feed">
      {items.map((item) => (
        <li className="activity-item" key={item.id}>
          <span className={`activity-dot activity-dot-${activityTone(item)}`} aria-hidden="true" />
          <div className="activity-copy">
            <p>
              <Link to={`/cases/${item.case_id}`}>{item.case_number}</Link>
              <span> · {item.body}</span>
            </p>
            <small>
              {item.actor} · {formatActivityTime(item.created_at)}
            </small>
          </div>
        </li>
      ))}
    </ol>
  )
}

export default function Dashboard({ user }) {
  const [days, setDays] = useState(7)
  const dashboard = useQuery({
    queryKey: ['dashboard', user.id, days],
    queryFn: () => api(`/dashboard?days=${days}`),
    refetchInterval: 30000,
  })
  const counts = dashboard.data?.counts || {}
  const stats = useMemo(
    () => [
      {
        label: 'Mis solicitudes',
        value: counts.mine,
        href: '/inbox/mine',
        icon: BriefcaseBusiness,
        color: 'blue',
        trend: 'A tu cargo',
      },
      {
        label: 'Requieren acción',
        value: counts.action,
        href: '/inbox/action',
        icon: BellRing,
        color: 'red',
        trend: 'Atención prioritaria',
      },
      {
        label: 'Órdenes en producción',
        value: counts.production_orders,
        href: '/inbox/production',
        icon: Printer,
        color: 'indigo',
        trend: 'En curso',
      },
      {
        label: 'Listas para entregar',
        value: counts.ready_orders,
        href: '/inbox/ready',
        icon: CheckCircle2,
        color: 'green',
        trend: 'Etapa final',
      },
    ],
    [counts.action, counts.mine, counts.production_orders, counts.ready_orders],
  )
  const canCreateRequest = can(user, 'attention')
  const canCreateOrder = can(user, 'production')
  const createHref = canCreateRequest ? '/inbox/mine?new=1' : '/inbox/production?newProduction=1'
  const createLabel = canCreateRequest ? 'Nueva solicitud' : 'Generar orden'

  if (dashboard.isPending) return <Loading />

  return (
    <div className="dashboard-page">
      <ErrorBox error={dashboard.error} />
      <div className="page-heading dashboard-heading">
        <div>
          <div className="eyebrow">COMUNICACIÓN GRÁFICA / OPERACIONES</div>
          <h1>Mi día</h1>
          <p>Resumen del trabajo que necesita atención en Comgraf.</p>
        </div>
        <div className="dashboard-actions">
          <label className="dashboard-period">
            <CalendarDays size={16} />
            <span className="sr-only">Período del resumen</span>
            <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
              <option value={7}>Últimos 7 días</option>
              <option value={30}>Últimos 30 días</option>
            </select>
          </label>
          {(canCreateRequest || canCreateOrder) && (
            <Link className="primary button" to={createHref}>
              <FilePlus2 size={16} /> {createLabel}
            </Link>
          )}
        </div>
      </div>

      <section className="dashboard-stats" aria-label="Resumen de operación">
        {stats.map(({ label, value, href, icon: Icon, color, trend }, index) => (
          <Link className={`stat-card stat-card-${color}`} to={href} key={label} style={{ '--card-index': index }}>
            <div className="stat-card-top">
              <span className="stat-icon"><Icon size={18} /></span>
              <span className={`stat-trend stat-trend-${color}`}><ArrowUpRight size={13} /> {trend}</span>
            </div>
            <strong>{value == null ? '—' : numberFormat.format(value)}</strong>
            <span className="stat-label">{label}</span>
          </Link>
        ))}
      </section>

      <div className="dashboard-content-grid">
        <section className="dashboard-card trend-card">
          <div className="dashboard-card-heading">
            <div>
              <span className="section-kicker">ACTIVIDAD</span>
              <h2>Solicitudes y órdenes</h2>
              <p>Volumen creado en el período seleccionado.</p>
            </div>
            <span className="trend-heading-icon"><TrendingUp size={18} /></span>
          </div>
          <div className="trend-legend">
            <span><i className="legend-dot legend-blue" /> Solicitudes</span>
            <span><i className="legend-dot legend-green" /> Órdenes de producción</span>
          </div>
          {dashboard.data?.trend?.length ? (
            <TrendChart points={dashboard.data.trend} days={days} />
          ) : (
            <p className="dashboard-no-data">No hay actividad en este período.</p>
          )}
        </section>

        <section className="dashboard-card activity-card">
          <div className="dashboard-card-heading">
            <div>
              <span className="section-kicker">EQUIPO</span>
              <h2>Actividad reciente</h2>
              <p>Últimos movimientos visibles para tu rol.</p>
            </div>
            <span className="activity-heading-icon"><ArrowUpRight size={17} /></span>
          </div>
          <ActivityFeed items={dashboard.data?.activity || []} />
          <Link className="activity-all-link" to="/inbox/history">
            Ver historial completo <ArrowRight size={14} />
          </Link>
        </section>
      </div>
    </div>
  )
}
