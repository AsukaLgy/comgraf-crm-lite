import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const credentials = JSON.parse(fs.readFileSync(path.resolve('../.runtime/e2e.json'), 'utf8'))
const headers = { 'X-Comgraf-Request': '1', 'X-Comgraf-Contract': '5', 'X-Comgraf-Build': '1.4.0' }

test('CAI presenta etiquetas y pulgadas sin añadir cálculos a la hoja impresa', async ({
  page,
}) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByRole('img', { name: 'Emblema de Comgraf' })).toBeVisible()
  await page.getByLabel('Usuario', { exact: true }).fill(credentials.username)
  await page.getByLabel('Contraseña', { exact: true }).fill(credentials.password)
  await page.getByRole('button', { name: 'Iniciar sesión' }).click()
  await expect(page.getByRole('heading', { name: 'Mi día', exact: true })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Emblema de Comgraf' })).toBeVisible()

  async function post(url, data) {
    const response = await page.request.post('/api' + url, { headers, data })
    expect(response.ok(), await response.text()).toBeTruthy()
    return response.json()
  }
  const client = await post('/clients', { name: 'E2E · CAI ' + Date.now() })
  let record = await post('/cases', {
    client_id: client.id,
    subject: 'E2E · Etiquetas CAI',
    kind: 'Solicitud',
    creation_context: 'personal',
  })
  record = await post(`/cases/${record.id}/take`, { version: record.version, key: randomUUID() })
  record = await post(`/cases/${record.id}/convert`, {
    version: record.version,
    key: randomUUID(),
    committed_date: '2099-12-31',
    payment_due_date: '2099-12-31',
    delivery_method: 'Retiro en taller',
    advance_required: '0',
    payment_terms: 'Contado',
    items: [
      {
        product: 'Talonarios de factura CAI',
        quantity: '10',
        unit: 'talonarios',
        unit_price: '125.00',
        specs: {
          cai_format: 'Media carta',
          games_per_pad: 50,
          paper_type: 'Químico',
          additional_copies: 2,
          cai_binding: 'Engrapado',
          fiscal_document_type: 'Factura',
          detail: 'Prueba visual',
        },
      },
    ],
  })

  await page.goto(`/cases/${record.id}?production_id=${record.production.id}&tab=production`)
  const specs = page.locator('.specs').first()
  await expect(page.getByRole('heading', { name: 'Talonario CAI', exact: true })).toBeVisible()
  await expect(specs).toContainText('Formato')
  await expect(specs).toContainText('Media carta (5.5 × 8.5 pulgadas)')
  await expect(specs).toContainText('Juegos por talonario')
  await expect(specs).toContainText('Tipo de papel')
  await expect(specs).toContainText('Número de copias')
  await expect(specs).toContainText('Tipo de encuadernación')
  await expect(specs).not.toContainText('Unidad de medida')

  await page.goto(`/cases/${record.id}/print?production_id=${record.production.id}`)
  const print = page.locator('.order-sheet')
  await expect(print).toContainText('Talonario CAI')
  await expect(print).toContainText('Media carta (5.5 × 8.5 pulgadas)')
  for (const excluded of [
    'Juegos por talonario',
    'Total de juegos',
    'Hojas por juego',
    'Total de hojas',
    'Precio por talonario',
    'Importe',
  ]) {
    await expect(print).not.toContainText(excluded)
  }
  expect(
    await page.evaluate(() =>
      [...document.styleSheets].some((sheet) => {
        try {
          return [...sheet.cssRules].some((rule) => rule.cssText.includes('size: 8.5in 5.5in'))
        } catch {
          return false
        }
      }),
    ),
  ).toBeTruthy()
  for (const asset of ['comgraf-logo.png', 'favicon-64.png']) {
    const response = await page.request.get('/branding/' + asset)
    expect(response.ok()).toBeTruthy()
    expect(response.headers()['content-type']).toContain('image/png')
  }
  expect(errors).toEqual([])

  await page.route(`**/api/cases/${record.id}*`, async (route) => {
    const response = await route.fetch()
    const historical = await response.json()
    historical.items[0].specs = { ...historical.items[0].specs }
    delete historical.items[0].specs.fiscal_document_type
    historical.production.specs_snapshot.items[0].specs = {
      ...historical.production.specs_snapshot.items[0].specs,
    }
    delete historical.production.specs_snapshot.items[0].specs.fiscal_document_type
    await route.fulfill({ response, json: historical })
  })
  await page.reload()
  await expect(page.locator('.order-sheet .fiscal-document-spec')).toContainText('No especificado')
  await expect(page.getByRole('img', { name: /QR estable de la orden/ })).toBeVisible()
})
