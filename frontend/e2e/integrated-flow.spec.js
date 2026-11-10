import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const credentials = JSON.parse(fs.readFileSync(path.resolve('../.runtime/e2e.json'), 'utf8'))
const headers = { 'X-Comgraf-Request': '1', 'X-Comgraf-Contract': '5', 'X-Comgraf-Build': '1.4.0' }

test('entrega con cobro, catálogo y panel se muestran por OP', async ({ page }) => {
  test.setTimeout(90000)
  const post = async (url, data) => {
    const response = await page.request.post('/api' + url, { headers, data })
    expect(response.ok(), await response.text()).toBeTruthy()
    return response.json()
  }
  await page.goto('/')
  await page.getByLabel('Usuario', { exact: true }).fill(credentials.username)
  await page.getByLabel('Contraseña', { exact: true }).fill(credentials.password)
  await page.getByRole('button', { name: 'Iniciar sesión' }).click()
  await expect(page.getByRole('heading', { name: 'Mi día' })).toBeVisible()
  const client = await post('/clients', { name: `E2E entrega ${Date.now()}` })
  let record = await post('/cases', {
    client_id: client.id,
    subject: 'Entrega y cobro integrado',
    kind: 'Solicitud',
    creation_context: 'pool',
  })
  record = await post(`/cases/${record.id}/convert`, {
    version: record.version,
    key: randomUUID(),
    items: [
      {
        product: 'Tarjetas de presentación',
        quantity: '10',
        unit: 'unidades',
        unit_price: '100',
        specs: {},
      },
    ],
    payment_due_date: '2099-12-31',
    delivery_method: 'Retiro en taller',
    payment_terms: 'Contado',
  })
  record = await post(`/cases/${record.id}/production/admin-stage`, {
    version: record.version,
    key: randomUUID(),
    production_id: record.production.id,
    stage: 'READY',
  })
  await page.goto(`/cases/${record.id}?production_id=${record.production.id}&tab=delivery`)
  await page.getByRole('button', { name: 'Registrar entrega de OP completa' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Total de la orden')).toBeVisible()
  await expect(dialog.getByText('Pagos registrados')).toBeVisible()
  await expect(dialog.getByText('Saldo pendiente')).toBeVisible()
  await expect(dialog.getByLabel('Cobro al entregar')).toHaveValue('now')
  await dialog.getByLabel('Referencia / comprobante').fill('Recibo E2E')
  await page.screenshot({ path: '../.runtime/integrated-delivery-desktop.png', fullPage: true })
  await dialog.getByRole('button', { name: 'Entregar y registrar cobro' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText('Pagado').first()).toBeVisible()
  const saved = await (
    await page.request.get(`/api/cases/${record.id}?production_id=${record.production.id}`)
  ).json()
  expect(saved.balance).toBe('0.00')
  expect(saved.delivery_status).toBe('Completa')
  expect(saved.lifecycle).toBe('Completado')
  await expect(
    page.getByText('Entrega registrada. Solicitud completada automáticamente'),
  ).toBeVisible()

  record = await post(`/cases/${record.id}/reactivate`, {
    version: saved.version,
    key: randomUUID(),
  })

  await page.goto(`/cases/${record.id}?production_id=${record.production.id}&tab=production`)
  await page.getByRole('button', { name: 'Agregar orden de producción' }).click()
  const productDialog = page.getByRole('dialog')
  await expect(
    productDialog.getByLabel('Producto').locator('option').filter({ hasText: /CAI/ }),
  ).toHaveCount(1)
  await productDialog.getByLabel('Producto').selectOption('Talonario CAI')
  await expect(productDialog.getByLabel('Cantidad de talonarios')).toHaveValue('1')
  await expect(productDialog.getByLabel('Juegos por talonario', { exact: true })).toBeVisible()
  await productDialog.getByLabel('Juegos por talonario', { exact: true }).selectOption('other')
  await productDialog.getByLabel('Cantidad de juegos por talonario').fill('10')
  await productDialog.getByLabel('Cantidad de talonarios').fill('2')
  await productDialog.getByLabel('Precio por talonario (HNL)').fill('20')
  await productDialog.getByLabel('Producto').selectOption('Talonarios y facturas')
  await expect(productDialog.getByLabel('Cantidad de talonarios')).toHaveValue('2')
  await expect(productDialog.getByLabel('Juegos por talonario', { exact: true })).toBeVisible()
  await expect(productDialog.getByLabel('Cantidad de talonarios')).toBeVisible()
  await expect(productDialog.getByLabel('Juegos por talonario', { exact: true })).toHaveValue(
    'other',
  )
  await expect(productDialog.getByLabel('Cantidad de juegos por talonario')).toHaveValue('10')
  await productDialog.getByLabel('Producto').selectOption('Talonario CAI')
  await productDialog.getByLabel('Tipo de encuadernación').selectOption('Engrapado')
  await page.screenshot({ path: '../.runtime/shared-product-form-desktop.png', fullPage: true })
  await productDialog.getByRole('button', { name: 'Generar orden de producción' }).click()
  await expect(productDialog.getByText('Orden creada en Aprobación.')).toBeVisible()
  await productDialog.getByRole('button', { name: 'Mantener en Aprobación' }).click()
  const newOrderId = new URL(page.url()).searchParams.get('production_id')
  const order = await (
    await page.request.get(`/api/cases/${record.id}?production_id=${newOrderId}`)
  ).json()
  expect(order.items[0].product).toBe('Talonario CAI')
  expect(order.items[0].specs.games_per_pad).toBe(10)
  expect(order.items[0].quantity).toBe('2.000')
  const stageBar = page.getByRole('list', {
    name: new RegExp(`Etapas de producción de ${order.production.order_number}`),
  })
  const current = stageBar.getByRole('button', {
    name: new RegExp(`^Aprobación de ${order.production.order_number}\\.`),
  })
  await expect(current).toBeDisabled()
  const beforeEvents = order.events.length
  await current.evaluate((button) => button.click())
  expect(
    (await (await page.request.get(`/api/cases/${record.id}?production_id=${newOrderId}`)).json())
      .events,
  ).toHaveLength(beforeEvents)
  const printing = stageBar.getByRole('button', {
    name: new RegExp(`^Impresión de ${order.production.order_number}\\.`),
  })
  await printing.focus()
  await printing.press('Enter')
  await expect(printing).toHaveAttribute('aria-current', 'step')
  await page.screenshot({ path: '../.runtime/stage-bar-desktop.png', fullPage: true })

  await page.goto('/indicators')
  await expect(page.getByRole('heading', { name: 'Indicadores' })).toBeVisible()
  await expect(page.getByText('OP entregadas con saldo', { exact: true })).toBeVisible()
  await page.screenshot({ path: '../.runtime/indicators-desktop.png', fullPage: true })
})
