import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'

const credentials = JSON.parse(fs.readFileSync(path.resolve('../.runtime/e2e.json'), 'utf8'))
const headers = { 'X-Comgraf-Request': '1', 'X-Comgraf-Contract': '5', 'X-Comgraf-Build': '1.4.0' }

async function login(page) {
  await page.goto('/')
  await page.getByLabel('Usuario', { exact: true }).fill(credentials.username)
  await page.getByLabel('Contraseña', { exact: true }).fill(credentials.password)
  await page.getByRole('button', { name: 'Iniciar sesión' }).click()
  await expect(page.getByRole('heading', { name: 'Mi día' })).toBeVisible()
}

async function post(page, url, data) {
  const response = await page.request.post(url, { headers, data })
  expect(response.ok(), `${url}: ${await response.text()}`).toBeTruthy()
  return response.json()
}

const caiItem = (type = 'Factura') => ({
  product: 'Talonario CAI',
  quantity: '1',
  unit: 'talonarios',
  unit_price: '25',
  specs: {
    cai_format: 'Media carta',
    games_per_pad: 25,
    paper_type: 'Químico',
    additional_copies: 2,
    cai_binding: 'Engrapado',
    fiscal_document_type: type,
    detail: 'Original y dos copias.',
  },
})

function referenceHtml(record, qrSrc) {
  const css = execFileSync('git', ['show', '52d70aa:frontend/src/styles.css'], {
    cwd: path.resolve('..'),
    encoding: 'utf8',
  })
  const caiCss = css.slice(css.indexOf('.cai-print{'), css.indexOf('.composer-footer'))
  const brandCss =
    css.match(/\.cai-print-brand\{[^}]*\}\s*\.cai-print-brand img\{[^}]*\}/)?.[0] || ''
  const order = record.production
  const identity = order.client_snapshot
  const item = order.specs_snapshot.items[0]
  const oldCreated = new Intl.DateTimeFormat('es-HN', {
    timeZone: 'America/Tegucigalpa',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(new Date(order.created_at))
  const esc = (value) =>
    String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
  const fields = [
    ['Empresa', identity.company],
    ['Persona', identity.person],
    ['RTN', identity.rtn],
    ['Teléfono', identity.phone],
    ['Correo', identity.email],
  ]
    .map(([label, value]) => `<span><b>${label}:</b> ${esc(value) || '—'}</span>`)
    .join('')
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;background:#f3f5f6}h1,h2,h3{font-family:Arial,sans-serif}
    ${caiCss}${brandCss}
    </style></head><body><article class="print-sheet cai-print">
      <header class="cai-print-header"><div class="cai-print-heading">
        <div class="cai-print-brand"><img src="http://127.0.0.1:8000/branding/comgraf-logo.png" alt=""><strong>Comunicación Gráfica</strong></div>
        <div class="cai-header-id"><strong>${esc(order.order_number)}</strong><span>Solicitud ${esc(record.number)}</span></div>
        <h1>Orden de producción — ${esc(item.product)}</h1>
        <div class="cai-meta"><span><b>Creada:</b> ${esc(oldCreated)}</span></div>
      </div><div class="cai-qr"><div class="order-qr cai-number-below"><img src="${qrSrc}" alt="QR de referencia"><strong class="qr-number">${esc(order.order_number)}</strong><div class="order-qr-details"></div></div></div></header>
      <section class="cai-client"><h2>Datos del cliente</h2><div>${fields}</div></section>
      <h2 class="cai-items-title">Especificaciones de la orden · ${esc(order.order_number)}</h2>
      <section class="cai-item"><h3>${esc(order.order_number)} · Producto 1 · ${esc(item.product)}</h3><dl>
        <div><dt>Formato</dt><dd>Media carta (5.5 × 8.5 pulgadas)</dd></div>
        <div><dt>Tipo de papel</dt><dd>${esc(item.specs.paper_type)}</dd></div>
        <div><dt>Encuadernación:</dt><dd>${esc(item.specs.cai_binding)}</dd></div>
        <div><dt>Número de copias:</dt><dd>${esc(item.specs.additional_copies)}</dd></div>
        <div><dt>Cantidad de talonarios</dt><dd>${esc(item.quantity)}</dd></div>
      </dl><p class="cai-observations"><b>${esc(order.order_number)} · Observaciones:</b> ${esc(item.specs.detail)}</p></section>
    </article></body></html>`
}

test('el diseño aprobado conserva los cinco datos y cambia correctamente entre OP', async ({
  page,
}) => {
  test.setTimeout(120000)
  await login(page)
  const client = await post(page, '/api/clients', {
    name: 'Cliente de prueba Aurora',
    company: 'Imprenta Aurora',
    rtn: '08011999001234',
    phones: ['+504 2222-3333'],
    emails: ['general@aurora.example.test'],
  })
  const ana = await post(page, `/api/clients/${client.id}/contacts`, {
    name: 'Ana Gómez',
    phone: '+504 9999-1111',
    email: 'ana@aurora.example.test',
  })
  const luis = await post(page, `/api/clients/${client.id}/contacts`, {
    name: 'Luis López',
    phone: '+504 9999-2222',
    email: 'luis@aurora.example.test',
  })
  let record = await post(page, '/api/cases', {
    client_id: client.id,
    contact_id: ana.id,
    subject: 'Comparación de plantilla CAI',
    kind: 'Solicitud',
    creation_context: 'personal',
  })
  record = await post(page, `/api/cases/${record.id}/take`, {
    version: record.version,
    key: randomUUID(),
  })
  const first = await post(page, `/api/cases/${record.id}/convert`, {
    version: record.version,
    key: randomUUID(),
    contact_id: ana.id,
    delivery_method: 'Retiro en local',
    items: [caiItem()],
  })
  const identity = first.production.client_snapshot
  expect(identity).toMatchObject({
    company: client.company,
    person: ana.name,
    rtn: client.rtn,
    phone: ana.phone,
    email: ana.email,
  })
  const profile = await (await page.request.get(`/api/clients/${client.id}`)).json()
  expect(profile.company).toBe(identity.company)
  expect(profile.rtn).toBe(identity.rtn)
  const second = await post(page, `/api/cases/${record.id}/convert`, {
    version: first.version,
    key: randomUUID(),
    contact_id: luis.id,
    delivery_method: 'Entrega',
    items: [
      {
        product: 'Banners y lonas',
        quantity: '2',
        unit: 'unidades',
        unit_price: '40',
        specs: { width: '1', height: '2', measure_unit: 'm', material: 'Lona 13 oz' },
      },
    ],
  })
  const third = await post(page, `/api/cases/${record.id}/convert`, {
    version: second.version,
    key: randomUUID(),
    contact_id: ana.id,
    delivery_method: 'Retiro en local',
    items: [
      caiItem('Nota de crédito'),
      {
        product: 'Volantes y flyers',
        quantity: '100',
        unit: 'unidades',
        unit_price: '1',
        specs: { width: '10', height: '15', measure_unit: 'cm', material: 'Couché' },
      },
    ],
  })
  await page.goto(`/cases/${record.id}/print?production_id=${first.production.id}`)
  await expect(page.locator('.order-sheet[data-layout-ready="true"]')).toBeVisible()
  const fields = page.locator('.order-sheet .order-sheet-client-fields span')
  await expect(fields).toHaveCount(5)
  for (const [label, value] of [
    ['Empresa:', identity.company],
    ['Persona:', identity.person],
    ['RTN:', identity.rtn],
    ['Teléfono:', identity.phone],
    ['Correo:', identity.email],
  ])
    await expect(fields.filter({ hasText: label })).toContainText(value)
  await expect(page.locator('.order-sheet')).toContainText('Número de copias')
  await expect(page.locator('.order-sheet')).not.toContainText('Copias adicionales')
  await expect(page.locator('.order-sheet')).not.toContainText('Juegos por talonario')
  await expect(page.getByRole('img', { name: /QR estable de la orden/ })).toBeVisible()
  await page.screenshot({ path: '../.runtime/approved-design-current.png', fullPage: true })
  await page.pdf({
    path: '../.runtime/approved-design-current.pdf',
    preferCSSPageSize: true,
    printBackground: true,
  })
  const pdfPng = path.resolve('../.runtime/approved-design-current-page.png')
  execFileSync('pdftoppm', [
    '-f',
    '1',
    '-l',
    '1',
    '-singlefile',
    '-png',
    '-r',
    '72',
    path.resolve('../.runtime/approved-design-current.pdf'),
    pdfPng.slice(0, -4),
  ])
  const rendered = PNG.sync.read(fs.readFileSync(pdfPng))
  for (const y of [365, 500]) {
    const offset = (rendered.width * y + 50) * 4
    expect([...rendered.data.subarray(offset, offset + 3)]).toEqual([255, 255, 255])
  }
  await page.evaluate(() => {
    const sheet = document.querySelector('.print-sheet')
    sheet.dataset.layoutReady = 'false'
    const placeholder = document.createElement('div')
    placeholder.className = 'qr-placeholder'
    sheet.append(placeholder)
    window.__printTiming = { ready: 0, printed: 0 }
    window.print = () => {
      window.__printTiming.printed = performance.now()
    }
    setTimeout(() => {
      placeholder.remove()
      sheet.dataset.layoutReady = 'true'
      window.__printTiming.ready = performance.now()
    }, 250)
  })
  await page.getByRole('button', { name: 'Imprimir / Guardar como PDF' }).click()
  await expect.poll(() => page.evaluate(() => window.__printTiming.printed)).toBeGreaterThan(0)
  expect(
    await page.evaluate(() => window.__printTiming.printed >= window.__printTiming.ready),
  ).toBe(true)
  const qrSrc = await page.locator('.order-sheet .order-qr img').first().getAttribute('src')
  const firstRecord = await (
    await page.request.get(`/api/cases/${record.id}?production_id=${first.production.id}`)
  ).json()
  await page.setContent(referenceHtml(firstRecord, qrSrc), { waitUntil: 'load' })
  await page.screenshot({
    path: '../.runtime/approved-design-reference-52d70aa.png',
    fullPage: true,
  })
  await page.goto(`/cases/${record.id}/print?production_id=${first.production.id}`)
  const picker = page.getByRole('combobox', { name: 'Orden de producción para imprimir' })
  await picker.selectOption(String(second.production.id))
  await expect(page.locator('.order-sheet[data-layout-ready="true"]')).toBeVisible()
  await expect(page.locator('.order-sheet')).toContainText('Luis López')
  await expect(page.locator('.order-sheet')).toContainText('Lona 13 oz')
  await expect(page.locator('.order-sheet')).not.toContainText('Cantidad de talonarios')
  await expect(page.locator('.order-sheet')).not.toContainText('Ana Gómez')
  await picker.selectOption(String(third.production.id))
  await expect(page.locator('.order-sheet[data-layout-ready="true"]')).toBeVisible()
  await expect(page.locator('.order-sheet .order-sheet-item')).toHaveCount(2)
  await expect(page.locator('.order-sheet .order-sheet-item').nth(0)).toContainText(
    'Nota de crédito',
  )
  await expect(page.locator('.order-sheet .order-sheet-item').nth(1)).not.toContainText(
    'Cantidad de talonarios',
  )
  await expect(
    page
      .getByRole('img', { name: `QR estable de la orden ${third.production.order_number}` })
      .first(),
  ).toBeVisible()
})

test('identidad opcional e histórica conserva vacíos y señala el origen', async ({ page }) => {
  await login(page)
  const client = await post(page, '/api/clients', { name: 'Cliente individual de prueba' })
  let record = await post(page, '/api/cases', {
    client_id: client.id,
    subject: 'Identidad opcional',
    kind: 'Solicitud',
    creation_context: 'personal',
  })
  record = await post(page, `/api/cases/${record.id}/take`, {
    version: record.version,
    key: randomUUID(),
  })
  record = await post(page, `/api/cases/${record.id}/convert`, {
    version: record.version,
    key: randomUUID(),
    delivery_method: 'Retiro en local',
    items: [caiItem()],
  })
  const url = `/cases/${record.id}/print?production_id=${record.production.id}`
  await page.goto(url)
  const fields = page.locator('.order-sheet .order-sheet-client-fields span')
  await expect(fields).toHaveCount(5)
  await expect(fields.nth(0)).toContainText('Empresa: —')
  await expect(fields.nth(1)).toContainText('Persona: Cliente individual de prueba')
  for (const index of [2, 3, 4]) await expect(fields.nth(index)).toContainText('—')
  await page.screenshot({ path: '../.runtime/approved-design-optional.png', fullPage: true })
  await page.route(`**/api/cases/${record.id}*`, async (route) => {
    const response = await route.fetch()
    const data = await response.json()
    data.production.client_snapshot = { company: 'Empresa histórica', rtn: '08011988000123' }
    await route.fulfill({ response, json: data })
  })
  await page.reload()
  await expect(page.locator('.order-sheet')).toContainText('Captura histórica incompleta')
  await expect(fields.nth(0)).toContainText('Empresa: Empresa histórica')
  await expect(fields.nth(1)).toContainText('Persona: —')
  await expect(fields.nth(4)).toContainText('Correo: —')
  await page.screenshot({
    path: '../.runtime/approved-design-partial-snapshot.png',
    fullPage: true,
  })
  await page.unrouteAll()
  await page.route(`**/api/cases/${record.id}*`, async (route) => {
    const response = await route.fetch()
    const data = await response.json()
    data.production.client_snapshot = null
    data.client.phones = ['2222-1111', '2222-2222']
    data.client.emails = ['uno@example.test', 'dos@example.test']
    await route.fulfill({ response, json: data })
  })
  await page.reload()
  await expect(page.locator('.order-sheet')).toContainText('OP histórica sin captura de identidad')
  await expect(fields.nth(1)).toContainText('Persona: Cliente individual de prueba')
  await expect(fields.nth(3)).toContainText('Teléfono: —')
  await expect(fields.nth(4)).toContainText('Correo: —')
  await page.screenshot({ path: '../.runtime/approved-design-no-snapshot.png', fullPage: true })
})
