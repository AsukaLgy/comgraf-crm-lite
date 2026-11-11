import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const credentials = JSON.parse(fs.readFileSync(path.resolve('../.runtime/e2e.json'), 'utf8'))
const headers = { 'X-Comgraf-Request': '1', 'X-Comgraf-Contract': '5', 'X-Comgraf-Build': '1.4.0' }

async function post(page, url, data) {
  const response = await page.request.post(url, { headers, data })
  expect(response.ok(), `${url}: ${await response.text()}`).toBeTruthy()
  return response.json()
}

test('una OP mixta extensa conserva la cabecera y el QR en páginas Carta y media carta', async ({
  page,
}) => {
  test.setTimeout(120000)
  await page.goto('/')
  await page.getByLabel('Usuario', { exact: true }).fill(credentials.username)
  await page.getByLabel('Contraseña', { exact: true }).fill(credentials.password)
  await page.getByRole('button', { name: 'Iniciar sesión' }).click()
  await expect(page.getByRole('heading', { name: 'Mi día' })).toBeVisible()
  const client = await post(page, '/api/clients', { name: `Prueba paginación ${Date.now()}` })
  let record = await post(page, '/api/cases', {
    client_id: client.id,
    subject: 'OP extensa para revisar paginación',
    kind: 'Solicitud',
    creation_context: 'personal',
  })
  record = await post(page, `/api/cases/${record.id}/take`, {
    version: record.version,
    key: randomUUID(),
  })
  const items = [
    {
      product: 'Talonario CAI',
      quantity: '1',
      unit: 'talonarios',
      unit_price: '20',
      specs: {
        cai_format: 'Media carta',
        games_per_pad: 25,
        paper_type: 'Bond',
        additional_copies: 1,
        cai_binding: 'Engrapado',
        fiscal_document_type: 'Recibo por honorarios profesionales',
        detail: 'Revisar numeración y logotipo. '.repeat(18),
      },
    },
    ...Array.from({ length: 7 }, (_, index) => ({
      product: 'Volantes y flyers',
      quantity: '250',
      unit: 'unidades',
      unit_price: '2',
      specs: {
        width: '10',
        height: '15',
        measure_unit: 'cm',
        material: 'Couché',
        detail:
          `Volante ${index + 1}. ` + 'Texto de observación extenso para imprenta. '.repeat(12),
      },
    })),
  ]
  const converted = await post(page, `/api/cases/${record.id}/convert`, {
    version: record.version,
    key: randomUUID(),
    delivery_method: 'Retiro en local',
    instructions: 'Separar los paquetes por producto. '.repeat(18),
    items,
  })
  const url = `/cases/${record.id}/print?production_id=${converted.production.id}`
  await page.goto(url)
  await expect(page.locator('.order-sheet[data-layout-ready="true"]')).toBeVisible()
  await expect(page.locator('.order-sheet')).toHaveAttribute('data-layout-overflow', 'false')
  await expect(page.locator('.order-sheet .order-sheet-item')).toHaveCount(8)
  await expect(page.getByRole('img', { name: /QR estable de la orden/ }).first()).toBeVisible()
  const out = path.resolve('../.runtime/order-long-letter.pdf')
  await page.pdf({ path: out, preferCSSPageSize: true, printBackground: true })
  const info = execFileSync('pdfinfo', [out], { encoding: 'utf8' })
  expect(info).toContain('Page size:       612 x 792 pts (letter)')
  const pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1])
  expect(pages).toBeGreaterThan(1)
  const text = execFileSync('pdftotext', ['-layout', out, '-'], { encoding: 'utf8' })
  const printedPages = text.split('\f').filter((part) => part.trim())
  expect(printedPages).toHaveLength(pages)
  for (const printed of printedPages) {
    expect(printed).toContain(converted.production.order_number)
    expect(printed).toContain('Orden de producción')
  }
  expect(text).toContain('Recibo por honorarios')
  expect(text).toContain('profesionales')
  expect(text).toContain('Volante 7')
  expect(text).not.toContain('Juegos por talonario')
  expect(text).not.toContain('Precio')
  const qrPng = path.resolve('../.runtime/order-long-qr.png')
  execFileSync('pdftoppm', [
    '-f',
    '1',
    '-l',
    '1',
    '-singlefile',
    '-png',
    '-r',
    '180',
    out,
    qrPng.slice(0, -4),
  ])
  await page.route('**/qr-test-decoder.js', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: fs.readFileSync('node_modules/@zxing/browser/umd/zxing-browser.min.js'),
    }),
  )
  await page.addScriptTag({ url: '/qr-test-decoder.js' })
  const decoded = await page.evaluate(
    async (url) => {
      const image = new Image()
      image.src = url
      await image.decode()
      const reader = new window.ZXingBrowser.BrowserQRCodeReader()
      return (await reader.decodeFromImageElement(image)).getText()
    },
    `data:image/png;base64,${fs.readFileSync(qrPng).toString('base64')}`,
  )
  expect(decoded).toBe(`CGOP1:${converted.production.scan_id}`)
  await page.getByLabel('Formato de papel').selectOption('half')
  const half = path.resolve('../.runtime/order-long-half.pdf')
  await page.pdf({ path: half, preferCSSPageSize: true, printBackground: true })
  expect(execFileSync('pdfinfo', [half], { encoding: 'utf8' })).toContain(
    'Page size:       612 x 396 pts',
  )
  await page.route(`**/api/cases/${record.id}*`, async (route) => {
    const response = await route.fetch()
    const historical = await response.json()
    historical.production.client_snapshot = null
    historical.production.specs_snapshot = null
    historical.production.approved_snapshot = null
    historical.production.cancelled_at = '2026-01-01T12:00:00'
    delete historical.items[0].specs.fiscal_document_type
    await route.fulfill({ response, json: historical })
  })
  await page.reload()
  await expect(page.locator('.order-sheet-page').first()).toContainText('OP ANULADA')
  await expect(page.locator('.order-sheet-page').first()).toContainText('No especificado')
  await expect(page.locator('.order-sheet-page').first()).toContainText(
    'Datos actuales del cliente; OP histórica sin captura de identidad.',
  )
})

test('una solicitud completada conserva su OP entregada para consulta e impresión', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByLabel('Usuario', { exact: true }).fill(credentials.username)
  await page.getByLabel('Contraseña', { exact: true }).fill(credentials.password)
  await page.getByRole('button', { name: 'Iniciar sesión' }).click()
  await expect(page.getByRole('heading', { name: 'Mi día' })).toBeVisible()
  const client = await post(page, '/api/clients', { name: `Prueba OP completada ${Date.now()}` })
  let record = await post(page, '/api/cases', {
    client_id: client.id,
    subject: 'Consulta histórica de OP entregada',
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
    payment_terms: 'Contado',
    items: [
      {
        product: 'Tarjetas de presentación',
        quantity: '100',
        unit: 'unidades',
        unit_price: '0',
        specs: { width: '9', height: '5', material: 'Couché 300 g' },
      },
    ],
  })
  const order = record.production
  record = await post(page, `/api/cases/${record.id}/production/admin-stage`, {
    version: record.version,
    key: randomUUID(),
    production_id: order.id,
    stage: 'READY',
  })
  record = await post(page, `/api/cases/${record.id}/deliveries/complete`, {
    version: record.version,
    key: randomUUID(),
    production_id: order.id,
    method: 'Retiro en local',
    receiver: 'Cliente',
    evidence: 'Entrega de prueba',
  })
  expect(record.lifecycle).toBe('Completado')
  await page.goto(`/cases/${record.id}?production_id=${order.id}&tab=production`)
  await expect(page.locator('.case-order-entry')).toContainText('Entregada')
  await expect(page.locator('.order-preview-sheet')).toContainText(order.order_number)
  await page.goto(`/cases/${record.id}/print?production_id=${order.id}`)
  await expect(page.locator('.order-sheet')).toContainText(order.order_number)
  await expect(
    page.getByRole('img', { name: `QR estable de la orden ${order.order_number}` }),
  ).toBeVisible()
})
