import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api, date, formatDateTime, localDate, dayKey } from './api'
import { Panel, Loading, ErrorBox, Badge, Empty, Field, Select } from './components'
import { promisedOrdersChartAxis } from './calendar-chart'

export function Calendar() {
  const location = useLocation(),
    params = new URLSearchParams(location.search)
  const [type, setType] = useState(params.get('type') || ''),
    [month, setMonth] = useState(
      params.get('month') === 'all' ? '' : params.get('month') || localDate().slice(0, 7),
    ),
    q = useQuery({
      queryKey: ['calendar', month],
      queryFn: () => {
        if (!month) return api('/calendar')
        const [year, monthNumber] = month.split('-').map(Number)
        const through = new Date(year, monthNumber, 0).getDate()
        return api(`/calendar?from=${month}-01&through=${month}-${String(through).padStart(2, '0')}`)
      },
    }),
    promised = useQuery({
      queryKey: ['calendar-promised-orders', month],
      enabled: Boolean(month),
      queryFn: () => {
        const [year, monthNumber] = month.split('-').map(Number)
        const through = new Date(year, monthNumber, 0).getDate()
        return api(
          `/calendar/promised-orders?from=${month}-01&through=${month}-${String(through).padStart(2, '0')}`,
        )
      },
    }),
    unscheduled = useQuery({
      queryKey: ['calendar-unscheduled-collections'],
      queryFn: () => api('/calendar/unscheduled-collections'),
    })
  const orderCounts = Object.fromEntries((promised.data?.days || []).map((day) => [day.date, day.orders]))
  const promisedDays = month
    ? (() => {
        const [year, monthNumber] = month.split('-').map(Number)
        const numberOfDays = new Date(year, monthNumber, 0).getDate()
        return Array.from({ length: numberOfDays }, (_, index) => {
          const day = `${month}-${String(index + 1).padStart(2, '0')}`
          return { date: day, orders: orderCounts[day] || 0 }
        })
      })()
    : []
  const totalPromised = promisedDays.reduce((total, day) => total + day.orders, 0)
  const busiestDay = promisedDays.reduce((busiest, day) => (day.orders > busiest.orders ? day : busiest), {
    date: '',
    orders: 0,
  })
  const { max: chartAxisMax, ticks: chartTicks } = promisedOrdersChartAxis(
    promisedDays.map((day) => day.orders),
  )
  const chartWidth = 780
  const chartHeight = 230
  const plotLeft = 42
  const plotTop = 14
  const plotWidth = 728
  const plotHeight = 170
  const slotWidth = promisedDays.length ? plotWidth / promisedDays.length : 0
  const barWidth = Math.min(14, slotWidth * 0.62)
  const items = (q.data || []).filter(
    (e) =>
      (!type || e.type === type) &&
      (!month || dayKey(e.date).startsWith(month)) &&
      (!params.has('overdue') ||
        (e.event_kind === 'collection_followup' && new Date(e.date) < new Date())),
  )
  const grouped = Object.groupBy(items, (e) => dayKey(e.date))
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">PLANIFICACIÓN DEL EQUIPO</div>
          <h1>Calendario</h1>
          <p>Fechas de acción, producción, entrega y cobro por orden.</p>
        </div>
      </div>
      <Panel
        title="Órdenes prometidas por día"
        action={month && <span className="calendar-chart-period">{new Date(`${month}-01T12:00:00`).toLocaleDateString('es-HN', { month: 'long', year: 'numeric' })}</span>}
      >
        {!month ? (
          <p className="muted">Selecciona un mes para consultar las OP pendientes por fecha comprometida.</p>
        ) : promised.isPending ? (
          <Loading />
        ) : promised.error ? (
          <ErrorBox error={promised.error} />
        ) : (
          <>
            <div className="calendar-kpi-summary">
              <div>
                <span>OP pendientes comprometidas en el mes</span>
                <strong>{totalPromised}</strong>
              </div>
              <p>
                Cuenta una vez cada OP no anulada ni entregada, según su fecha comprometida vigente.
                {busiestDay.orders > 0 && (
                  <> Mayor carga: {date(busiestDay.date)} ({busiestDay.orders} OP).</>
                )}
              </p>
            </div>
            <div
              className="calendar-promised-chart"
              role="img"
              aria-label={`OP pendientes prometidas por fecha durante ${month}: ${promisedDays.map((day) => `día ${day.date.slice(-2)}, ${day.orders} OP`).join('; ')}`}
            >
              <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} aria-hidden="true" focusable="false">
                {chartTicks.map((tick) => {
                  const y = plotTop + plotHeight - (tick / chartAxisMax) * plotHeight
                  return (
                    <g key={tick}>
                      <line className="calendar-chart-grid" x1={plotLeft} x2={plotLeft + plotWidth} y1={y} y2={y} />
                      <text className="calendar-chart-y-label" x={plotLeft - 10} y={y + 4} textAnchor="end">
                        {tick}
                      </text>
                    </g>
                  )
                })}
                {promisedDays.map((day, index) => {
                  const height = day.orders ? (day.orders / chartAxisMax) * plotHeight : 0
                  const x = plotLeft + index * slotWidth + (slotWidth - barWidth) / 2
                  const showLabel = index === 0 || (index + 1) % 5 === 0 || index === promisedDays.length - 1
                  return (
                    <g key={day.date}>
                      {day.orders > 0 && (
                        <rect
                          className="calendar-promised-bar"
                          x={x}
                          y={plotTop + plotHeight - height}
                          width={barWidth}
                          height={height}
                          rx="4"
                        />
                      )}
                      {showLabel && (
                        <text
                          className={`calendar-chart-x-label${index === 0 ? ' landmark' : ''}`}
                          x={plotLeft + index * slotWidth + slotWidth / 2}
                          y={plotTop + plotHeight + 22}
                          textAnchor="middle"
                        >
                          {Number(day.date.slice(-2))}
                        </text>
                      )}
                    </g>
                  )
                })}
              </svg>
            </div>
          </>
        )}
      </Panel>
      <Panel title="Agenda del equipo">
        <div className="filters">
          <Field
            label="Mes"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
          <Select
            label="Tipo de evento"
            options={[
              'Seguimiento de atención',
              'Inicio programado de producción',
              'Entrega comprometida',
              'Seguimiento de cobro',
              'Vencimiento de pago',
            ]}
            empty="Todos"
            value={type}
            onChange={(e) => setType(e.target.value)}
          />
        </div>
        <ErrorBox error={q.error} />
        {q.isPending ? (
          <Loading />
        ) : items.length ? (
          Object.entries(grouped).map(([day, events]) => (
            <section className="agenda-day" key={day}>
              <h3>{date(day)}</h3>
              <div>
                {events.map((e) => (
                  <Link
                    to={
                      e.production_id
                        ? `/cases/${e.case_id}?production_id=${e.production_id}&from=%2Fcalendar&return=%2Fcalendar`
                        : `/cases/${e.case_id}?from=%2Fcalendar&return=%2Fcalendar`
                    }
                    className={'calendar-event ' + e.event_kind}
                    key={e.id}
                  >
                    <Badge
                      tone={
                        e.event_kind === 'scheduled'
                          ? 'teal'
                          : e.event_kind === 'committed'
                            ? 'amber'
                            : e.event_kind === 'payment_due'
                              ? 'red'
                              : ''
                      }
                    >
                      {e.type}
                    </Badge>
                    <strong>{e.title}</strong>
                    <span>{e.action}</span>
                    {e.state_label && <Badge>{e.state_label}</Badge>}
                    {e.stage_label && e.state_label !== e.stage_label && (
                      <span>Etapa: {e.stage_label}</span>
                    )}
                    <small>
                      {e.date_label}{' '}
                      {['followup', 'collection_followup', 'scheduled'].includes(e.event_kind)
                        ? formatDateTime(e.date)
                        : date(e.date)}
                      {e.original && ` · Compromiso original: ${date(e.original)}`}
                    </small>
                  </Link>
                ))}
              </div>
            </section>
          ))
        ) : (
          <Empty>No hay eventos en este período.</Empty>
        )}
      </Panel>
      <Panel title="Cobros sin seguimiento programado">
        <ErrorBox error={unscheduled.error} />
        {unscheduled.isPending ? (
          <Loading />
        ) : unscheduled.data?.length ? (
          <div className="unscheduled-collections">
            {unscheduled.data.map((order) => (
              <Link
                className="calendar-event collection-missing"
                key={order.id}
                to={`/cases/${order.case_id}?production_id=${order.id}&tab=delivery&from=%2Fcalendar&return=%2Fcalendar`}
              >
                <Badge tone="red">{order.status_label}</Badge>
                <strong>
                  {order.client} · {order.case_number} · {order.order_number}
                </strong>
                <span>
                  {order.title} · {order.delivered ? 'Entregada' : 'En producción'} · Sin fecha de
                  llamada programada
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <Empty>Todos los saldos pendientes tienen un seguimiento de cobro programado.</Empty>
        )}
      </Panel>
    </>
  )
}

const stageCodes = {
  'Sin clasificar': '',
  Nuevo: 'NEW',
  Aprobación: 'APPROVAL',
  Impresión: 'PRINTING',
  Encuadernación: 'WORKSHOP',
}
function MetricLink({ label, value, to, description }) {
  return (
    <Link className="metric" to={to}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{description}</small>
    </Link>
  )
}
export function Indicators() {
  const q = useQuery({ queryKey: ['indicators'], queryFn: () => api('/indicators') })
  if (q.isPending) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const d = q.data,
    c = d.current,
    pickup = d.pickup,
    collection = d.collection,
    compliance = d.compliance
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">CONTROL OPERATIVO</div>
          <h1>Indicadores</h1>
          <p>
            Situación actual: solicitudes para atención; órdenes para producción, retiro y cobranza.
          </p>
        </div>
      </div>
      <Panel title="Carga actual">
        <div className="metrics">
          <MetricLink
            label="Solicitudes sin asignar"
            value={c.unassigned_cases}
            to="/inbox/pool"
            description="Abrir Bandeja general"
          />
          <MetricLink
            label="Solicitudes que requieren acción"
            value={c.action_cases}
            to="/inbox/action"
            description="Abrir bandeja de atención"
          />
          <MetricLink
            label="OP atrasadas"
            value={c.late_orders}
            to="/inbox/late"
            description="Compromiso anterior a hoy"
          />
          <MetricLink
            label="OP listas sin entregar"
            value={c.ready_orders}
            to="/inbox/ready"
            description="Abrir bandeja de retiro"
          />
        </div>
        <div className="kpi-row">
          <strong>OP pendientes por etapa</strong>
        </div>
        <div className="metrics stage-metrics">
          {Object.entries(c.production_by_stage).map(([stage, count]) => (
            <MetricLink
              key={stage}
              label={stage}
              value={count}
              to={`/inbox/production?stage=${stageCodes[stage] || 'unclassified'}`}
              description="Abrir órdenes"
            />
          ))}
        </div>
      </Panel>
      <Panel title="Trabajos pendientes de retiro">
        <div className="metrics">
          {collection && (
            <>
              <MetricLink
                label="Sin pagos recibidos"
                value={pickup.unpaid}
                to="/inbox/ready?pickup=unpaid"
                description="Prioridad de retiro"
              />
              <MetricLink
                label="Con anticipo y saldo"
                value={pickup.partial}
                to="/inbox/ready?pickup=partial"
                description="Saldo por cobrar"
              />
              <MetricLink
                label="Pagadas sin retirar"
                value={pickup.paid}
                to="/inbox/ready?pickup=paid"
                description="Lista para entrega"
              />
            </>
          )}
        </div>
        <h3>Más días listas</h3>
        {d.oldest_ready.map((order) => (
          <div className="kpi-row" key={order.id}>
            <Link to={`/cases/${order.case_id}?production_id=${order.id}&tab=delivery`}>
              OP-{String(order.id).padStart(5, '0')}
            </Link>
            <strong>{order.days} días</strong>
          </div>
        ))}
        {!d.oldest_ready.length && <Empty />}
      </Panel>
      {collection && (
        <Panel title="Cobranza operativa">
          <div className="metrics">
            <MetricLink
              label="OP entregadas con saldo"
              value={collection.delivered_pending}
              to="/inbox/delivered-balances"
              description="Referencia operativa de cobro"
            />
            <MetricLink
              label="OP entregadas con saldo vencido"
              value={collection.delivered_overdue}
              to="/inbox/delivered-overdue"
              description="Abrir órdenes vencidas"
            />
            <MetricLink
              label="Seguimientos de cobro pendientes"
              value={collection.followups_pending}
              to="/calendar"
              description="Abrir agenda"
            />
            <MetricLink
              label="Seguimientos de cobro vencidos"
              value={collection.followups_overdue}
              to="/calendar?type=Seguimiento+de+cobro&month=all&overdue=yes"
              description="Abrir agenda vencida"
            />
          </div>
        </Panel>
      )}
      <Panel title={`Cumplimiento · ${date(d.period.from)} a ${date(d.period.through)}`}>
        <p>
          <strong>
            {compliance.denominator
              ? `${Math.round((100 * compliance.numerator) / compliance.denominator)} %`
              : 'Sin muestra'}
          </strong>{' '}
          ·{' '}
          <Link to="/inbox/delivered-period?commitment=ontime">
            {compliance.numerator} a tiempo
          </Link>{' '}
          de{' '}
          <Link to="/inbox/delivered-period?commitment=dated">
            {compliance.denominator} OP con compromiso original
          </Link>
          .
        </p>
        <p>
          <Link to="/inbox/delivered-period?commitment=missing">
            {compliance.without_original_date} OP entregadas sin fecha comprometida original
          </Link>
          , informadas por separado.
        </p>
        <small>
          Resultado histórico de los últimos 30 días. Se excluyen órdenes anuladas. Las
          actualizaciones de etapa son manuales.
        </small>
      </Panel>
    </>
  )
}
