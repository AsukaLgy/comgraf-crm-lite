import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const credentials = JSON.parse(fs.readFileSync(path.resolve('../.runtime/e2e.json'), 'utf8'))
const headers = { 'X-Comgraf-Request': '1', 'X-Comgraf-Contract': '5', 'X-Comgraf-Build': '1.4.0' }

async function post(page, url, data) {
  const response = await page.request.post(url, { headers, data })
  expect(response.ok(), `${url}: ${await response.text()}`).toBeTruthy()
  return response.json()
}

async function createOrder(page, label, stage, scheduled = false) {
  const client = await post(page, '/api/clients', { name: `QA agenda ${label} ${Date.now()}` })
  let record = await post(page, '/api/cases', {
    client_id: client.id, subject: `QA agenda ${label}`, kind: 'Solicitud', creation_context: 'personal',
  })
  record = await post(page, `/api/cases/${record.id}/convert`, {
    version: record.version, key: randomUUID(),
    items: [{ product: 'Banners y lonas', quantity: '2', unit: 'unidades', unit_price: '250.00',
      specs: { measure_unit: 'cm', width: '100', height: '200', material: 'Lona 13 oz' } }],
    committed_date: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
    payment_due_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    delivery_method: 'Retiro en taller', payment_terms: 'Contado', advance_required: '0.00',
  })
  const order = record.production
  if (scheduled) {
    record = await post(page, `/api/cases/${record.id}/production/schedule`, {
      version: record.version, key: randomUUID(), production_id: order.id,
      scheduled_at: new Date(Date.now() + 86400000).toISOString(),
      committed_date: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
    })
  }
  if (stage !== 'APPROVAL') {
    record = await post(page, `/api/cases/${record.id}/production/stage`, {
      version: record.version, key: randomUUID(), production_id: order.id, stage: 'PRINTING',
    })
  }
  if (stage === 'READY') {
    record = await post(page, `/api/cases/${record.id}/production/stage`, {
      version: record.version, key: randomUUID(), production_id: order.id, stage: 'WORKSHOP',
    })
    const finish = await page.request.post(`/api/cases/${record.id}/production/confirm-finished`, {
      headers, data: { production_id: order.id },
    })
    expect(finish.ok(), await finish.text()).toBeTruthy()
  }
  return { id: record.id, order }
}

test('bandejas, agenda y plantilla impresa identifican cada OP', async ({ page }) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await page.getByLabel('Usuario', { exact: true }).fill(credentials.username)
  await page.getByLabel('Contraseña', { exact: true }).fill(credentials.password)
  await page.getByRole('button', { name: 'Iniciar sesión' }).click()
  await expect(page.getByRole('heading', { name: 'Mi día' })).toBeVisible()

  const printing = await createOrder(page, 'Printing', 'PRINTING')
  const ready = await createOrder(page, 'Ready', 'READY')
  await createOrder(page, 'Scheduled', 'APPROVAL', true)

  await page.goto('/inbox/production')
  // Fixtures are inserted through the API outside React Query's mutation flow.
  await page.reload()
  await expect(page.getByRole('row').filter({ hasText: printing.order.order_number })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: ready.order.order_number })).toHaveCount(0)
  const productionCountsResponse = await page.request.get('/api/counts')
  const productionCounts = await productionCountsResponse.json()
  await expect(page.locator('.list-footer')).toContainText(`${productionCounts.production_orders} órdenes en esta bandeja`)
  await page.screenshot({ path: '../.runtime/qa-production-inbox.png', fullPage: true })

  await page.goto('/inbox/ready')
  await page.reload()
  await expect(page.getByRole('row').filter({ hasText: ready.order.order_number })).toBeVisible()
  const countsResponse = await page.request.get('/api/counts')
  const counts = await countsResponse.json()
  await expect(page.locator('.list-footer')).toContainText(`${counts.ready_orders} órdenes en esta bandeja`)
  await page.screenshot({ path: '../.runtime/qa-ready-inbox.png', fullPage: true })

  await page.goto('/calendar')
  await expect(page.getByRole('heading', { name: 'Calendario' })).toBeVisible()
  await expect(page.getByText('Agenda del equipo')).toBeVisible()
  await expect(page.getByRole('link').filter({ hasText: 'Inicio programado de producción' }).first()).toBeVisible()
  await expect(page.getByRole('link').filter({ hasText: 'Entrega comprometida' }).first()).toBeVisible()
  await expect(page.getByRole('link').filter({ hasText: 'Vencimiento de pago' }).first()).toBeVisible()
  await expect(page.getByText(/Cobros sin seguimiento programado/)).toBeVisible()
  await page.screenshot({ path: '../.runtime/qa-calendar.png', fullPage: true })

  await page.goto(`/cases/${printing.id}/print?production_id=${printing.order.id}`)
  await expect(page.locator('.print-sheet')).toContainText('Comunicación Gráfica')
  await expect(page.locator('.print-sheet>header')).not.toContainText(/comgraf/i)
  const logo = page.locator('.print-sheet>header img[src="/branding/comgraf-logo.png"]')
  await expect(logo).toBeVisible()
  expect(await logo.evaluate((image) => image.naturalWidth)).toBeGreaterThan(10)
  await expect(page.getByRole('img', { name: `QR estable de la orden ${printing.order.order_number}` })).toBeVisible()
  await page.screenshot({ path: '../.runtime/qa-print-general.png', fullPage: true })
  expect(errors).toEqual([])
})
