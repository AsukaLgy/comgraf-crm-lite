import { useLayoutEffect, useRef, useState } from 'react'
import { date, formatDateTime } from './api'
import { isCaiProduct, usesPrintForm } from './domain'
import OrderQRCode from './OrderQRCode'

const caiDimensions = {
  'Media carta': '5.5 × 8.5',
  'Cuarto de carta': '4.25 × 5.5',
  '8.5 × 7.25': '8.5 × 7.25',
  '8.5 × 8.5': '8.5 × 8.5',
  Carta: '8.5 × 11',
}
const genericFields = [
  ['material', 'Material'],
  ['inks', 'Tintas'],
  ['copies', 'Copias'],
  ['numbering', 'Numeración'],
  ['sheets', 'Hojas'],
  ['binding', 'Encuadernación'],
  ['finishes', 'Acabados'],
]

function textChunks(value, limit = 140) {
  let remaining = String(value || '').trim()
  const chunks = []
  while (remaining.length > limit) {
    let end = remaining.lastIndexOf(' ', limit)
    if (end < limit / 2) end = limit
    chunks.push(remaining.slice(0, end))
    remaining = remaining.slice(end).trimStart()
  }
  if (remaining) chunks.push(remaining)
  return chunks
}

function field(label, value) {
  return value === undefined || value === null || value === '' ? null : { label, value }
}

function itemFields(item) {
  const specs = item.specs || {}
  if (usesPrintForm(item.product))
    return [
      isCaiProduct(item.product) &&
        field('Tipo de documento fiscal', specs.fiscal_document_type || 'No especificado'),
      field(
        'Formato',
        specs.cai_format &&
          `${specs.cai_format}${caiDimensions[specs.cai_format] ? ` (${caiDimensions[specs.cai_format]} pulgadas)` : ''}`,
      ),
      field('Papel', specs.paper_type),
      field('Encuadernación', specs.cai_binding),
      field('Copias adicionales', specs.additional_copies),
      field('Cantidad de talonarios', item.quantity),
    ].filter(Boolean)
  const dimensions =
    specs.width && specs.height
      ? `${specs.width} × ${specs.height} ${specs.measure_unit || ''}`.trim()
      : null
  return [
    field('Cantidad', `${item.quantity ?? '—'} ${item.unit || ''}`.trim()),
    field('Dimensiones', dimensions),
    field('Caras', specs.sides),
    ...genericFields.map(([key, label]) => field(label, specs[key])),
  ].filter(Boolean)
}

function identityFor(record, production) {
  if (production.client_snapshot)
    return { ...production.client_snapshot, historicalFallback: false }
  const client = record.client || {}
  return {
    company: client.company || '',
    person: record.case_contact?.name || (!client.company ? client.name : ''),
    rtn: client.rtn || '',
    phone: record.case_contact?.phone || client.phones?.[0] || '',
    email: record.case_contact?.email || client.emails?.[0] || '',
    historicalFallback: true,
  }
}

function SheetHeader({ record, production, items, identity, measureRef }) {
  return (
    <header className="order-sheet-header" ref={measureRef}>
      <div className="order-sheet-heading">
        <div className="order-sheet-brand">
          <img src="/branding/comgraf-logo.png" alt="" />
          <strong>Comunicación Gráfica</strong>
        </div>
        <h1>Orden de producción</h1>
        <div className="order-sheet-identifiers">
          <strong>{production.order_number}</strong>
          <span>Solicitud {record.number}</span>
        </div>
        {production.cancelled_at && <strong className="order-sheet-cancelled">OP ANULADA</strong>}
        <div className="order-sheet-dates">
          <span>Creada: {formatDateTime(production.created_at)}</span>
          {production.committed_date && (
            <span>Fecha comprometida: {date(production.committed_date)}</span>
          )}
        </div>
      </div>
      <div className="order-sheet-qr">
        <OrderQRCode
          production={production}
          caseNumber={record.number}
          description={items.map((item) => item.product).join(', ')}
          client={identity.company || identity.person}
          numberBelow
        />
      </div>
    </header>
  )
}

function sheetRows(items, production, identity, client, contact) {
  const rows = [
    {
      key: 'client',
      content: (
        <section className="order-sheet-client">
          <h2>Cliente</h2>
          <p>{client || 'No especificado'}</p>
          {identity.company && identity.person && <p>Contacto: {identity.person}</p>}
          {contact && <p>{contact}</p>}
          {identity.historicalFallback && (
            <small>Datos actuales del cliente; OP histórica sin captura de identidad.</small>
          )}
        </section>
      ),
    },
  ]
  items.forEach((item, index) => {
    rows.push({
      key: `item-${index}`,
      content: (
        <section className="order-sheet-item">
          <h2>
            Producto {index + 1}: {item.product}
          </h2>
          <dl>
            {itemFields(item).map(({ label, value }) => (
              <div
                key={label}
                className={
                  label === 'Tipo de documento fiscal' ? 'fiscal-document-spec' : undefined
                }
              >
                <dt>{label}:</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ),
    })
  })
  items.forEach((item, index) => {
    textChunks(item.specs?.detail).forEach((chunk, chunkIndex) => {
      rows.push({
        key: `detail-${index}-${chunkIndex}`,
        content: (
          <section className="order-sheet-notes">
            <strong>
              Producto {index + 1} · Observaciones{chunkIndex ? ' (continuación)' : ''}:
            </strong>{' '}
            {chunk}
          </section>
        ),
      })
    })
  })
  textChunks(production.instructions).forEach((chunk, index) => {
    rows.push({
      key: `instructions-${index}`,
      content: (
        <section className="order-sheet-notes">
          <strong>Instrucciones{index ? ' (continuación)' : ''}:</strong> {chunk}
        </section>
      ),
    })
  })
  return rows
}

export default function CasePrintSheet({ record, preview = false }) {
  const production = record.production
  const measureRef = useRef(null)
  const headerRef = useRef(null)
  const [layout, setLayout] = useState(null)
  const items =
    production?.specs_snapshot?.items || production?.approved_snapshot?.items || record.items || []
  const identity = production ? identityFor(record, production) : null
  const contact = identity ? [identity.phone, identity.email].filter(Boolean).join(' · ') : ''
  const client = identity
    ? [identity.company || identity.person, identity.rtn && `RTN ${identity.rtn}`]
        .filter(Boolean)
        .join(' · ')
    : ''
  const rows = production ? sheetRows(items, production, identity, client, contact) : []
  useLayoutEffect(() => {
    if (!production || !measureRef.current || !headerRef.current) return
    const rowElements = [...measureRef.current.children]
    // Both paper modes expose the same 4.94-inch content height. Measure the actual
    // wrapped text at print width instead of assuming a fixed number of products.
    const budget = 4.94 * 96 - headerRef.current.getBoundingClientRect().height - 10
    const groups = [[]]
    let used = 0
    rowElements.forEach((element, index) => {
      const height = element.getBoundingClientRect().height
      if (used + height > budget && groups.at(-1).length) {
        groups.push([])
        used = 0
      }
      groups.at(-1).push(index)
      used += height
    })
    setLayout((current) =>
      current?.productionId === production.id &&
      JSON.stringify(current.groups) === JSON.stringify(groups)
        ? current
        : { productionId: production.id, groups },
    )
  }, [production])
  if (!production) return null
  const groups =
    layout?.productionId === production.id && layout.groups.flat().length === rows.length
      ? layout.groups
      : [rows.map((_, index) => index)]
  return (
    <>
      <div className="order-sheet-measure" aria-hidden="true" ref={measureRef}>
        {rows.map((row) => (
          <div className="order-sheet-row" key={row.key}>
            {row.content}
          </div>
        ))}
      </div>
      <article className={`print-sheet order-sheet${preview ? ' order-preview-sheet' : ''}`}>
        {groups.map((group, pageIndex) => (
          <div className="order-sheet-page" key={`${production.id}-${pageIndex}`}>
            <SheetHeader
              record={record}
              production={production}
              items={items}
              identity={identity}
              measureRef={pageIndex === 0 ? headerRef : undefined}
            />
            {group.map((index) => (
              <div className="order-sheet-row" key={rows[index].key}>
                {rows[index].content}
              </div>
            ))}
          </div>
        ))}
      </article>
    </>
  )
}
