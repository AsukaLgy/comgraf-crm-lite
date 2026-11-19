import { useEffect, useState } from 'react'
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, Paperclip, Printer } from 'lucide-react'
import {
  api,
  can,
  date,
  formatDateTime,
  money,
  quantity,
  toUTC,
  timezone,
  localInput,
  uid,
} from './api'
import { Badge, ErrorBox, Loading, Panel, Empty } from './components'
import { Specifications } from './ProductForm'
import CaseAttention from './CaseAttention'
import CaseActivity from './CaseActivity'
import CasePrintSheet from './CasePrintSheet'
import OrderQRCode from './OrderQRCode'
import DeliveryFinance from './DeliveryFinance'
import ProductionStages from './ProductionStages'
import { OrderList } from './OrderNavigation'
import { isCaiProduct } from './domain'
import { invalidateCaseViews } from './caseCache'
import CaseDialogs, { CancellationPreview, CancellationSummary } from './CaseDialogs'
const reason = { name: 'reason', label: 'Motivo', type: 'textarea', required: true }
const sectionParam = {
  Actividad: 'activity',
  Cotizaciones: 'quotes',
  Producción: 'production',
  'Entregas y cobros': 'delivery',
  Archivos: 'files',
}
const sectionByParam = Object.fromEntries(
  Object.entries(sectionParam).map(([section, param]) => [param, section]),
)

export default function CasePage({ user, print = false }) {
  const { id } = useParams(),
    nav = useNavigate(),
    [searchParams, setSearchParams] = useSearchParams(),
    selectedProductionId = searchParams.get('production_id') || '',
    qc = useQueryClient(),
    [modal, setModal] = useState(null),
    [finishResult, setFinishResult] = useState(null),
    [finishBusy, setFinishBusy] = useState(false),
    [attentionError, setAttentionError] = useState(null),
    [attentionBusy, setAttentionBusy] = useState(false),
    [completionNotice, setCompletionNotice] = useState('')
  useEffect(() => {
    const closeOnHistory = () =>
      setModal((current) => (current?.type === 'confirm_finished' ? null : current))
    window.addEventListener('popstate', closeOnHistory)
    return () => window.removeEventListener('popstate', closeOnHistory)
  }, [])
  const section =
    sectionByParam[searchParams.get('tab')] || (selectedProductionId ? 'Producción' : 'Actividad')
  function setSection(next) {
    const params = new URLSearchParams(searchParams)
    params.set('tab', sectionParam[next])
    setSearchParams(params)
  }
  function selectProduction(productionId) {
    if (String(productionId) === selectedProductionId) return
    setModal(null)
    const params = new URLSearchParams(searchParams)
    params.set('production_id', String(productionId))
    if (!params.has('tab')) params.set('tab', sectionParam[section])
    setSearchParams(params)
  }
  const query = useQuery({
      queryKey: ['case', id, selectedProductionId],
      queryFn: () =>
        api(
          '/cases/' + id + (selectedProductionId ? `?production_id=${selectedProductionId}` : ''),
        ),
      refetchInterval: print ? false : 15000,
      refetchOnWindowFocus: !print,
    }),
    people = useQuery({ queryKey: ['users'], queryFn: () => api('/users') })
  useEffect(() => {
    if (selectedProductionId || !query.data?.production?.id) return
    const params = new URLSearchParams(searchParams)
    params.set('production_id', String(query.data.production.id))
    if (!params.has('tab')) params.set('tab', sectionParam[section])
    setSearchParams(params, { replace: true })
  }, [selectedProductionId, query.data?.production?.id, searchParams, setSearchParams, section])
  if (query.isPending) return <Loading />
  if (query.error) return <ErrorBox error={query.error} />
  if (selectedProductionId && String(query.data.production?.id) !== selectedProductionId)
    return <ErrorBox error="La orden seleccionada no pertenece a esta solicitud." />
  const c = query.data,
    p = c.production,
    users = people.data || [],
    close = () => setModal(null)
  const attention =
      can(user, 'attention') && (Number(c.owner_id) === Number(user.id) || can(user, 'assign')),
    canTake = can(user, 'attention') && !c.owner_id && c.lifecycle !== 'Completado',
    production = can(user, 'production'),
    finance = can(user, 'finance')
  const activeAttention = attention && c.lifecycle !== 'Completado'
  const completionBlockers = c.completion_blockers || []
  function openFinishConfirmation() {
    setFinishResult(null)
    setModal({
      type: 'confirm_finished',
      caseId: c.id,
      productionId: p.id,
      orderNumber: p.order_number,
      selectionKey: selectedProductionId,
    })
  }
  async function changeLifecycle(action) {
    const result = await api(`/cases/${c.id}/${action}`, {
      method: 'POST',
      body: { version: c.version, key: uid() },
    })
    qc.setQueryData(['case', String(c.id), selectedProductionId], result)
    await qc.invalidateQueries()
  }
  const person = (id) => users.find((u) => u.id === id)?.name || 'Sin asignar'
  const personOptions = (permission) =>
    users.filter((u) => u.active && can(u, permission)).map((u) => ({ value: u.id, label: u.name }))
  const operation = (
    path,
    title,
    fields = [],
    initial = {},
    transform,
    submit,
    method = 'POST',
    children,
    renderSummary,
  ) =>
    setModal({
      type: 'operation',
      path,
      title,
      fields,
      initial,
      transform,
      submit,
      method,
      children,
      renderSummary,
    })
  const assign = () =>
    operation(
      'assign',
      'Asignar solicitud',
      [
        {
          name: 'owner_id',
          label: 'Responsable principal',
          options: personOptions('attention'),
          empty: 'Sin asignar',
        },
      ],
      { owner_id: c.owner_id || '' },
      (v) => ({ ...v, owner_id: v.owner_id ? Number(v.owner_id) : null }),
    )
  async function toggleAttention() {
    if (attentionBusy) return
    setAttentionBusy(true)
    setAttentionError(null)
    try {
      const result = await api('/cases/' + c.id + '/attention', {
        method: 'POST',
        body: {
          status: c.status === 'Cerrado' ? 'Abierto' : 'Cerrado',
          version: c.version,
          key: uid(),
        },
      })
      qc.setQueryData(['case', String(c.id), selectedProductionId], result)
      await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'case' })
    } catch (error) {
      setAttentionError(error)
      if (error.status === 409) await query.refetch()
    } finally {
      setAttentionBusy(false)
    }
  }
  function schedule() {
    operation(
      'production/schedule',
      'Programar producción y compromiso',
      [
        {
          name: 'scheduled_at',
          label: `Inicio programado (${timezone})`,
          type: 'datetime-local',
          required: true,
        },
        {
          name: 'committed_date',
          label: 'Fecha comprometida de entrega',
          type: 'date',
          required: true,
        },
      ],
      { committed_date: p.committed_date || '' },
      (v) => ({ ...v, scheduled_at: toUTC(v.scheduled_at) }),
    )
  }
  function delivery() {
    const eligible = (c.productions || []).filter(
      (order) =>
        !order.cancelled_at &&
        !order.blocked_since &&
        !order.classification_required &&
        order.stage === 'READY' &&
        order.delivery_status !== 'Completa',
    )
    if (!eligible.length) return
    setModal({ type: 'complete_delivery', orders: eligible })
  }
  if (print) return <CasePrintSheet id={id} record={c} person={person} />
  return (
    <>
      <button
        className="back-link"
        onClick={() => {
          const target = searchParams.get('return')
          if (
            target &&
            /^\/(inbox\/(pool|mine|production|ready|finalized|history)|calendar|search)([?][^#]*)?$/.test(
              target,
            )
          )
            nav(target)
          else nav(-1)
        }}
      >
        <ArrowLeft size={16} />
        Volver a la bandeja
      </button>
      {completionNotice && (
        <div className="notice" role="status">
          {completionNotice}
        </div>
      )}
      {user.roles.includes('Administrador') && (
        <details className="secondary-actions">
          <summary>Más acciones</summary>
          <button type="button" className="danger" onClick={() => setModal({ type: 'delete' })}>
            Eliminar definitivamente
          </button>
        </details>
      )}
      <CaseAttention
        record={c}
        onEditTitle={async (title) => {
          await api(`/cases/${c.id}/title`, {
            method: 'PATCH',
            body: { title, version: c.version },
          })
          await invalidateCaseViews(qc, { caseId: c.id, clientId: c.client.id })
        }}
        person={person}
        canAttend={activeAttention}
        canTake={canTake}
        canAssign={can(user, 'assign') && c.lifecycle !== 'Completado'}
        onTake={() => operation('take', 'Tomar solicitud', [], {}, undefined, 'Tomar solicitud')}
        onAssign={assign}
        onConvert={() => setModal({ type: 'convert' })}
        onToggle={toggleAttention}
        attentionError={attentionError}
        attentionBusy={attentionBusy}
        onRefresh={() => query.refetch()}
        onEdit={() =>
          operation(
            'details',
            'Editar datos de la solicitud',
            [
              {
                name: 'priority',
                label: 'Prioridad',
                options: ['Baja', 'Normal', 'Alta', 'Urgente'],
                required: true,
              },
              { name: 'next_action', label: 'Próxima acción', required: false },
            ],
            { priority: c.priority, next_action: c.next_action },
            (v) => ({ priority: v.priority, next_action: v.next_action }),
          )
        }
        canComplete={completionBlockers.length === 0}
        completionBusy={attentionBusy}
        canReactivate={attention}
        onComplete={() => setModal({ type: 'complete' })}
        onReactivate={async () => {
          if (attentionBusy) return
          setAttentionBusy(true)
          setAttentionError(null)
          try {
            await changeLifecycle('reactivate')
          } catch (error) {
            setAttentionError(error)
            if (error.status === 409) await query.refetch()
          } finally {
            setAttentionBusy(false)
          }
        }}
      />
      {p && (
        <ProductionStages
          record={c}
          isAdmin={user.roles.includes('Administrador')}
          onAdminStage={async (stage) => {
            const result = await api(`/cases/${c.id}/production/admin-stage`, {
              method: 'POST',
              body: { production_id: p.id, stage, version: c.version, key: uid() },
            })
            qc.setQueryData(['case', id, selectedProductionId], result)
            await invalidateCaseViews(qc, { caseId: c.id, clientId: c.client.id, counts: true })
            return result
          }}
          onAdvanceStage={async (stage) => {
            const result = await api(`/cases/${c.id}/production/stage`, {
              method: 'POST',
              body: { production_id: p.id, stage, version: c.version, key: uid() },
            })
            qc.setQueryData(['case', id, selectedProductionId], result)
            await invalidateCaseViews(qc, { caseId: c.id, clientId: c.client.id, counts: true })
            return result
          }}
          onRefresh={() => query.refetch()}
          canManage={production && c.lifecycle !== 'Completado'}
          onSelectProduction={selectProduction}
          onConfirmFinished={openFinishConfirmation}
          confirmBusy={finishBusy}
          onSchedule={schedule}
          onDelivery={delivery}
          operation={operation}
        />
      )}
      <div className="case-grid">
        <div className="case-main">
          <div className="tabs section-tabs">
            {[
              'Actividad',
              'Cotizaciones',
              ...(c.production_count ? ['Producción', 'Entregas y cobros'] : []),
              'Archivos',
            ].map((s) => (
              <button
                className={section === s ? 'active' : ''}
                key={s}
                onClick={() => setSection(s)}
              >
                {s}
                {s === 'Archivos' && <span>{c.attachments.length}</span>}
              </button>
            ))}
          </div>
          {section === 'Actividad' && (
            <CaseActivity
              record={c}
              attention={activeAttention}
              user={user}
              person={person}
              onReference={(reference) => {
                window.setTimeout(
                  () =>
                    document
                      .getElementById(reference)
                      ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
                  0,
                )
              }}
            />
          )}
          {section === 'Cotizaciones' && (
            <Panel
              title="Cotizaciones y versiones"
              action={
                activeAttention && (
                  <button onClick={() => setModal({ type: 'quote' })}>
                    <Plus size={15} />
                    Nueva versión
                  </button>
                )
              }
            >
              {c.quotes.length ? (
                c.quotes.map((q) => (
                  <article className="quote" id={`quote-${q.id}`} key={q.id}>
                    <div className="section-line">
                      <h3>
                        Versión {q.version}{' '}
                        <Badge tone={q.status === 'Aceptada' ? 'teal' : ''}>{q.status}</Badge>
                      </h3>
                      <strong>{money(q.total, q.currency)}</strong>
                    </div>
                    <p className="muted">
                      Vigencia: {date(q.valid_until)} · {q.items.length} productos
                    </p>
                    {q.items.map((i, n) => (
                      <details key={n}>
                        <summary>
                          {i.product} · {quantity(i.quantity)} {i.unit} ·{' '}
                          {money(i.unit_price, q.currency)} / unidad
                          {isCaiProduct(i.product) &&
                            ` · Tipo de documento fiscal: ${i.specs?.fiscal_document_type || 'No especificado'}`}
                        </summary>
                        <Specifications specs={i.specs} product={i.product} />
                      </details>
                    ))}
                    {q.decision_evidence && <p>{q.decision_evidence}</p>}
                    <div className="actions">
                      {activeAttention && (
                        <button onClick={() => setModal({ type: 'quote', source: q })}>
                          Revisar en nueva versión
                        </button>
                      )}
                      {activeAttention && q.status === 'Pendiente' && (
                        <button
                          onClick={() =>
                            operation(
                              `quotes/${q.id}/decision`,
                              'Registrar decisión de cotización',
                              [
                                {
                                  name: 'status',
                                  label: 'Decisión',
                                  options: ['Aceptada', 'Rechazada'],
                                },
                                {
                                  name: 'evidence',
                                  label: 'Evidencia / comunicación del cliente',
                                  type: 'textarea',
                                  required: true,
                                },
                              ],
                              { status: 'Aceptada' },
                            )
                          }
                        >
                          Registrar decisión
                        </button>
                      )}
                      {activeAttention &&
                        q.status === 'Aceptada' &&
                        q.currency === 'HNL' &&
                        !q.production_id && (
                          <button
                            className="primary"
                            onClick={() => setModal({ type: 'convert', source: q })}
                          >
                            Generar orden con esta versión
                          </button>
                        )}
                      {q.production_id && (
                        <Link
                          className="button"
                          to={`/cases/${c.id}?production_id=${q.production_id}&tab=production&from=${encodeURIComponent(searchParams.get('from') || '/inbox/mine')}&return=${encodeURIComponent(searchParams.get('return') || '/inbox/mine')}`}
                        >
                          Ver {q.order_number}
                        </Link>
                      )}
                    </div>
                  </article>
                ))
              ) : (
                <Empty>
                  Aún no hay cotizaciones. Puedes cotizar en lempiras sin iniciar fabricación.
                </Empty>
              )}
            </Panel>
          )}
          {section === 'Producción' && c.production_count > 0 && (
            <Panel
              title={`Órdenes de producción · ${c.production_count} · ${c.production_pending_count} pendientes`}
              action={
                activeAttention && (
                  <button className="primary" onClick={() => setModal({ type: 'convert' })}>
                    <Plus size={15} />
                    Agregar orden de producción
                  </button>
                )
              }
            >
              <OrderList
                caseId={c.id}
                orders={c.productions}
                selectedId={p?.id}
                onSelect={selectProduction}
              />
            </Panel>
          )}
          {section === 'Producción' && p && (
            <Panel title="Especificaciones de producción">
              <div id="production" />
              <div className="notice">
                Etapa actual: {p.stage_label || 'Pendiente de clasificación'}. Las especificaciones
                capturadas al generar se conservan como referencia histórica.
              </div>
              {c.items.map((i) => (
                <article className="quote" key={i.id}>
                  <div className="section-line">
                    <h3>{i.product}</h3>
                  </div>
                  <p>
                    {quantity(i.quantity)} {i.unit}
                    {i.unit_price !== undefined &&
                      ' · ' + money(i.unit_price, p.currency) + ' / unidad'}
                  </p>
                  <Specifications specs={i.specs} product={i.product} />
                </article>
              ))}
              <h3>Instrucciones</h3>
              <p className="prewrap">{p.instructions || 'Sin instrucciones adicionales'}</p>
              <OrderQRCode
                production={p}
                caseNumber={c.number}
                description={p.instructions || c.subject}
                client={c.client.name}
                compact
              />
              {can(user, 'production') &&
                c.lifecycle !== 'Completado' &&
                !p.cancelled_at &&
                c.delivery_status !== 'Completa' && (
                  <button
                    className="danger"
                    onClick={() =>
                      operation(
                        'production/cancel',
                        'Anular trabajo',
                        [
                          { ...reason, label: 'Motivo de anulación' },
                          ...(finance && can(user, 'adjust')
                            ? [
                                {
                                  name: 'treatment',
                                  label: 'Tratamiento económico',
                                  options: [
                                    { value: 'SIN_CARGO', label: 'Sin cargo por cancelación' },
                                    {
                                      value: 'IMPORTE_FINAL',
                                      label: 'Con importe final acordado a cobrar',
                                    },
                                  ],
                                  empty: 'Seleccionar tratamiento',
                                  required: true,
                                },
                                {
                                  name: 'final_amount',
                                  label: 'Importe final acordado (HNL)',
                                  type: 'number',
                                  min: '0',
                                  step: '0.01',
                                  required: (v) => v.treatment === 'IMPORTE_FINAL',
                                  when: (v) => v.treatment === 'IMPORTE_FINAL',
                                },
                              ]
                            : []),
                        ],
                        {},
                        (v) => ({
                          reason: v.reason,
                          ...(v.treatment ? { treatment: v.treatment } : {}),
                          ...(v.treatment === 'IMPORTE_FINAL'
                            ? { final_amount: v.final_amount }
                            : {}),
                        }),
                        undefined,
                        undefined,
                        <CancellationSummary record={c} />,
                        (values) => <CancellationPreview record={c} values={values} />,
                      )
                    }
                  >
                    Anular trabajo
                  </button>
                )}
              {p.cancelled_at &&
                p.cancellation_review_pending &&
                finance &&
                can(user, 'adjust') && (
                  <button
                    className="primary"
                    onClick={() =>
                      operation(
                        'production/cancel/resolve',
                        'Resolver situación económica de la anulación',
                        [
                          { ...reason, label: 'Nota de resolución' },
                          {
                            name: 'treatment',
                            label: 'Tratamiento económico',
                            options: [
                              { value: 'SIN_CARGO', label: 'Sin cargo por cancelación' },
                              {
                                value: 'IMPORTE_FINAL',
                                label: 'Con importe final acordado a cobrar',
                              },
                            ],
                            empty: 'Seleccionar tratamiento',
                            required: true,
                          },
                          {
                            name: 'final_amount',
                            label: 'Importe final acordado (HNL)',
                            type: 'number',
                            min: '0',
                            step: '0.01',
                            required: (v) => v.treatment === 'IMPORTE_FINAL',
                            when: (v) => v.treatment === 'IMPORTE_FINAL',
                          },
                        ],
                        {},
                        (v) => ({
                          reason: v.reason,
                          treatment: v.treatment,
                          ...(v.treatment === 'IMPORTE_FINAL'
                            ? { final_amount: v.final_amount }
                            : {}),
                        }),
                        undefined,
                        undefined,
                        <CancellationSummary record={c} />,
                        (values) => <CancellationPreview record={c} values={values} />,
                      )
                    }
                  >
                    Resolver situación económica
                  </button>
                )}
            </Panel>
          )}
          {section === 'Producción' && p && (
            <div className="order-preview-panel">
              <Panel
                title={`Vista previa · ${p.order_number}`}
                action={
                  <a
                    className="button primary"
                    target="_blank"
                    rel="noopener noreferrer"
                    href={`/cases/${id}/print?production_id=${p.id}`}
                  >
                    <Printer size={16} />
                    Imprimir orden de producción
                  </a>
                }
              >
                <CasePrintSheet id={id} record={c} person={person} preview />
              </Panel>
            </div>
          )}
          {section === 'Entregas y cobros' && p && (
            <DeliveryFinance
              record={c}
              user={user}
              finance={finance && c.lifecycle !== 'Completado'}
              onOperation={operation}
              onDeliver={delivery}
              canDeliver={
                production &&
                c.lifecycle !== 'Completado' &&
                (c.productions || []).some(
                  (order) =>
                    !order.cancelled_at &&
                    !order.blocked_since &&
                    !order.classification_required &&
                    order.stage === 'READY' &&
                    order.delivery_status !== 'Completa',
                )
              }
            />
          )}
          {section === 'Archivos' && (
            <Panel
              title="Archivos de la solicitud"
              action={
                (activeAttention || (production && p && c.lifecycle !== 'Completado')) && (
                  <button onClick={() => setModal({ type: 'upload' })}>
                    <Paperclip size={15} />
                    Adjuntar archivo
                  </button>
                )
              }
            >
              <p className="muted">
                PDF, PNG, JPG o TXT · hasta 20 MB por archivo. Los artes se vinculan a una versión.
              </p>
              {c.attachments.map((a) => (
                <div className="attachment" key={a.id}>
                  <Paperclip size={18} />
                  <div>
                    <a href={'/api/attachments/' + a.id}>{a.name}</a>
                    <small>
                      Versión del arte: {a.art_version || 'Sin versión'} ·{' '}
                      {(a.size / 1024).toFixed(1)} KB · {formatDateTime(a.created_at)}
                    </small>
                  </div>
                </div>
              ))}
              {!c.attachments.length && <Empty>No hay archivos adjuntos.</Empty>}
            </Panel>
          )}
        </div>
        <aside className="case-aside">
          <Panel title="Cliente">
            <div className="client-avatar">{c.client.name.slice(0, 2).toUpperCase()}</div>
            <h3>
              {can(user, 'clients') ? (
                <Link to={'/clients/' + c.client.id}>{c.client.name}</Link>
              ) : (
                c.client.name
              )}
            </h3>
            <p className="muted">
              {c.client.company || 'Cliente particular'}
              {c.client.provisional ? ' · Provisional' : ''}
            </p>
            {c.client.rtn && <p>RTN {c.client.rtn}</p>}
            {c.client.phones.map((p) => (
              <p key={p}>{p}</p>
            ))}
            {c.client.emails.map((e) => (
              <p key={e}>{e}</p>
            ))}
            {c.client.addresses.map((a) => (
              <p key={a}>{a}</p>
            ))}
            {c.description && (
              <>
                <hr />
                <p className="prewrap">{c.description}</p>
              </>
            )}
          </Panel>

          <Panel
            title="Próxima acción"
            action={
              (activeAttention || (finance && p && Number(c.balance) > 0)) && (
                <button
                  className="icon-button"
                  aria-label="Programar seguimiento"
                  onClick={() =>
                    operation(
                      'tasks',
                      'Programar seguimiento',
                      [
                        { name: 'title', label: 'Acción a realizar', required: true },
                        ...(finance
                          ? [
                              {
                                name: 'purpose',
                                label: 'Propósito',
                                options: [
                                  { value: 'ATTENTION', label: 'Seguimiento de atención' },
                                  { value: 'COLLECTION', label: 'Seguimiento de cobro' },
                                ],
                              },
                            ]
                          : []),
                        {
                          name: 'owner_id',
                          label: 'Responsable',
                          options: (values) =>
                            personOptions(
                              values.purpose === 'COLLECTION' ? 'finance' : 'attention',
                            ),
                          required: true,
                        },
                        {
                          name: 'due_at',
                          label: `Fecha y hora (${timezone})`,
                          type: 'datetime-local',
                          required: true,
                        },
                      ],
                      {
                        owner_id: user.id,
                        purpose: finance && !can(user, 'attention') ? 'COLLECTION' : 'ATTENTION',
                      },
                      (v) => ({
                        ...v,
                        owner_id: Number(v.owner_id),
                        due_at: toUTC(v.due_at),
                        production_id: v.purpose === 'COLLECTION' ? p?.id : undefined,
                      }),
                    )
                  }
                >
                  <Plus size={16} />
                </button>
              )
            }
          >
            <p>{c.next_action || 'Sin próxima acción definida'}</p>
            {c.tasks.map((t) => (
              <div className="task" key={t.id}>
                <strong>{t.title}</strong>
                <Badge>
                  {t.purpose === 'COLLECTION' ? 'Seguimiento de cobro' : 'Seguimiento de atención'}
                </Badge>
                <small>
                  {formatDateTime(t.due_at)} · {person(t.owner_id)}
                </small>
                {t.done_at ? (
                  <Badge tone="teal">Completado</Badge>
                ) : (
                  <>
                    {new Date(t.due_at) < new Date() && <Badge tone="red">Vencido</Badge>}
                    {(t.purpose === 'COLLECTION' ? finance : activeAttention) && (
                      <>
                        <button
                          onClick={() =>
                            operation(
                              `tasks/${t.id}/complete`,
                              t.category === 'PICKUP'
                                ? 'Registrar contacto de recogida'
                                : 'Completar seguimiento',
                              t.category === 'PICKUP'
                                ? [
                                    {
                                      name: 'note',
                                      label: 'Resumen del contacto',
                                      type: 'textarea',
                                    },
                                    {
                                      name: 'schedule_next_pickup',
                                      label:
                                        'Programar otro seguimiento en siete días si no se recoge',
                                      type: 'checkbox',
                                    },
                                  ]
                                : [],
                              { schedule_next_pickup: false },
                              (values) => ({
                                note: values.note || '',
                                schedule_next_pickup: Boolean(values.schedule_next_pickup),
                              }),
                              'Guardar contacto',
                            )
                          }
                        >
                          {t.category === 'PICKUP' ? 'Registrar contacto' : 'Completar'}
                        </button>
                        <button
                          onClick={() =>
                            operation(
                              `tasks/${t.id}`,
                              'Reprogramar seguimiento',
                              [
                                {
                                  name: 'due_at',
                                  label: `Nueva fecha y hora (${timezone})`,
                                  type: 'datetime-local',
                                  required: true,
                                },
                              ],
                              { due_at: localInput(t.due_at) },
                              (v) => ({ due_at: toUTC(v.due_at) }),
                              undefined,
                              'PUT',
                            )
                          }
                        >
                          Reprogramar
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            ))}
          </Panel>
          {p && (
            <Panel title="Compromisos">
              <dl className="key-values">
                <dt>Fecha solicitada</dt>
                <dd>{date(p.requested_date)}</dd>
                <dt>Compromiso original</dt>
                <dd>{date(p.original_committed_date)}</dd>
                <dt>Compromiso actual</dt>
                <dd>{date(p.committed_date)}</dd>
                <dt>Programación</dt>
                <dd>{formatDateTime(p.scheduled_at)}</dd>
                <dt>Entrega</dt>
                <dd>{p.delivery_method}</dd>
              </dl>
            </Panel>
          )}
          {c.status === 'Cerrado' && (
            <Panel title="Cierre de atención">
              <p>{c.close_reason}</p>
              <p>{c.close_summary}</p>
              <small>{formatDateTime(c.closed_at)}</small>
            </Panel>
          )}
        </aside>
      </div>
      <CaseDialogs
        modal={modal}
        record={c}
        user={user}
        finance={finance}
        selectedProductionId={selectedProductionId}
        finishResult={finishResult}
        setFinishResult={setFinishResult}
        setFinishBusy={setFinishBusy}
        onClose={close}
        onCompletionNotice={setCompletionNotice}
        onCompleteCase={() => changeLifecycle('complete')}
        onSelectProduction={(order) => {
          const params = new URLSearchParams(searchParams)
          params.set('production_id', String(order.id))
          params.set('tab', 'production')
          setSearchParams(params)
        }}
        onDeleted={() => nav('/inbox/mine')}
      />
    </>
  )
}
