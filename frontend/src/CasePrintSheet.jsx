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
      field('Tipo de papel', specs.paper_type),
      field('Encuadernación', specs.cai_binding),
      field('Número de copias', specs.additional_copies),
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
  if (production.client_snapshot) {
    const snapshot = production.client_snapshot
    const keys = ['company', 'person', 'rtn', 'phone', 'email']
    return {
      ...Object.fromEntries(keys.map((key) => [key, snapshot[key] ?? ''])),
      historicalFallback: false,
      incompleteSnapshot: keys.some(
        (key) => !Object.hasOwn(snapshot, key) || snapshot[key] == null,
      ),
    }
  }
  const client = record.client || {}
  const phone = record.case_contact?.phone || (client.phones?.length === 1 ? client.phones[0] : '')
  const email = record.case_contact?.email || (client.emails?.length === 1 ? client.emails[0] : '')
  return {
    company: client.company || '',
    person: record.case_contact?.name || (!client.company ? client.name : ''),
    rtn: client.rtn || '',
    phone,
    email,
    historicalFallback: true,
    incompleteSnapshot: false,
  }
}

function SheetHeader({ record, production, items, identity, measureRef }) {
  const products = [...new Set(items.map((item) => item.product))].join(', ')
  return (
    <header className="order-sheet-header" ref={measureRef}>
      <div className="order-sheet-heading">
        <div className="order-sheet-brand">
          <img src="/branding/comgraf-logo.png" alt="" />
          <strong>Comunicación Gráfica</strong>
        </div>
        <div className="order-sheet-identifiers">
          <strong>{production.order_number}</strong>
          <span>Solicitud {record.number}</span>
        </div>
        <h1>Orden de producción{products ? ` — ${products}` : ''}</h1>
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

function sheetRows(items, production, identity) {
  const rows = [
    {
      key: 'client',
      content: (
        <section className="order-sheet-client">
          <h2>Datos del cliente</h2>
          <div className="order-sheet-client-fields">
            {[
              ['Empresa', identity.company],
              ['Persona', identity.person],
              ['RTN', identity.rtn],
              ['Teléfono', identity.phone],
              ['Correo', identity.email],
            ].map(([label, value]) => (
              <span key={label}>
                <b>{label}:</b> {value || '—'}
              </span>
            ))}
          </div>
          {identity.historicalFallback && (
            <small>Datos actuales del cliente; OP histórica sin captura de identidad.</small>
          )}
          {identity.incompleteSnapshot && (
            <small>
              Captura histórica incompleta; los campos ausentes no se sustituyeron por datos
              actuales.
            </small>
          )}
        </section>
      ),
    },
  ]
  items.forEach((item, index) => {
    const fields = itemFields(item)
    const size = usesPrintForm(item.product) ? 6 : 3
    for (let offset = 0; offset < fields.length; offset += size) {
      const continuation = offset > 0
      rows.push({
        key: `item-${index}-${offset}`,
        content: (
          <section className="order-sheet-item">
            {index === 0 && !continuation && (
              <h2 className="order-sheet-specs-title">
                Especificaciones de la orden · {production.order_number}
              </h2>
            )}
            <h3>
              {production.order_number} · Producto {index + 1} · {item.product}
              {continuation ? ' (continuación)' : ''}
            </h3>
            <dl>
              {fields.slice(offset, offset + size).map(({ label, value }) => (
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
    }
  })
  items.forEach((item, index) => {
    textChunks(item.specs?.detail).forEach((chunk, chunkIndex) => {
      rows.push({
        key: `detail-${index}-${chunkIndex}`,
        content: (
          <section className="order-sheet-notes">
            <strong>
              {production.order_number} · Producto {index + 1} · Observaciones
              {chunkIndex ? ' (continuación)' : ''}:
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
          <strong>
            {production.order_number} · Instrucciones{index ? ' (continuación)' : ''}:
          </strong>{' '}
          {chunk}
        </section>
      ),
    })
  })
  return rows
}

export default function CasePrintSheet({ record, preview = false }) {
  const production = record.production
  const productionId = production?.id
  const measureRef = useRef(null)
  const headerRef = useRef(null)
  const [layout, setLayout] = useState(null)
  const items =
    production?.specs_snapshot?.items || production?.approved_snapshot?.items || record.items || []
  const identity = production ? identityFor(record, production) : null
  const rows = production ? sheetRows(items, production, identity) : []
  const contentSignature = JSON.stringify({
    id: productionId,
    number: record.number,
    clientSnapshot: production?.client_snapshot,
    client: production?.client_snapshot ? null : record.client,
    caseContact: production?.client_snapshot ? null : record.case_contact,
    items,
    instructions: production?.instructions,
    createdAt: production?.created_at,
    committedDate: production?.committed_date,
    cancelledAt: production?.cancelled_at,
  })
  useLayoutEffect(() => {
    if (!productionId || !measureRef.current || !headerRef.current) return
    let active = true
    let assetsReady = false
    const calculate = () => {
      if (!active || !measureRef.current || !headerRef.current) return
      const rowElements = [...measureRef.current.children]
      // Both paper modes expose the same 4.94-inch content height. Measure wrapped
      // text at print width after fonts and images settle, and on later size changes.
      const budget = 4.94 * 96 - headerRef.current.getBoundingClientRect().height - 10
      const groups = [[]]
      let used = 0
      let oversized = false
      rowElements.forEach((element, index) => {
        const height = element.getBoundingClientRect().height
        if (height > budget) oversized = true
        if (used + height > budget && groups.at(-1).length) {
          groups.push([])
          used = 0
        }
        groups.at(-1).push(index)
        used += height
      })
      setLayout((current) =>
        current?.signature === contentSignature &&
        current.ready === assetsReady &&
        current.oversized === oversized &&
        JSON.stringify(current.groups) === JSON.stringify(groups)
          ? current
          : { signature: contentSignature, groups, ready: assetsReady, oversized },
      )
    }
    calculate()
    const observer = new ResizeObserver(calculate)
    observer.observe(measureRef.current)
    observer.observe(headerRef.current)
    const images = [...headerRef.current.querySelectorAll('img')]
    Promise.all([
      document.fonts.ready,
      ...images.map((image) => image.decode().catch(() => {})),
    ]).then(() => {
      if (!active) return
      assetsReady = true
      calculate()
    })
    return () => {
      active = false
      observer.disconnect()
    }
  }, [contentSignature, productionId])
  if (!production) return null
  const groups =
    layout?.signature === contentSignature && layout.groups.flat().length === rows.length
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
      <article
        className={`print-sheet order-sheet${preview ? ' order-preview-sheet' : ''}`}
        data-layout-ready={
          layout?.signature === contentSignature && layout.ready ? 'true' : 'false'
        }
        data-layout-overflow={
          layout?.signature === contentSignature && layout.oversized ? 'true' : 'false'
        }
      >
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
