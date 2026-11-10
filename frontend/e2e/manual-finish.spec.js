import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const credentials = JSON.parse(fs.readFileSync(path.resolve('../.runtime/e2e.json'), 'utf8'))
const headers = { 'X-Comgraf-Request': '1', 'X-Comgraf-Contract': '5', 'X-Comgraf-Build': '1.4.0' }

test('la OP seleccionada se confirma desde Actividad junto a las etapas', async ({ page }) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await page.getByLabel('Usuario', { exact: true }).fill(credentials.username)
  await page.getByLabel('Contraseña', { exact: true }).fill(credentials.password)
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Mi día', exact: true })).toBeVisible()

  async function post(url, data) {
    const response = await page.request.post('/api' + url, { headers, data })
    expect(response.ok(), await response.text()).toBeTruthy()
    return response.json()
  }
  const client = await post('/clients', { name: 'E2E · Trabajo terminado ' + Date.now() })
  let record = await post('/cases', {
    client_id: client.id,
    subject: 'E2E · Confirmación manual',
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
        product: 'Tarjetas de presentación',
        quantity: '100',
        unit: 'unidades',
        unit_price: '10.00',
        specs: { width: '9', height: '5', material: 'Couché 300 g', sides: '2', inks: 'CMYK' },
      },
    ],
  })
  record = await post(`/cases/${record.id}/production/stage`, {
    version: record.version,
    key: randomUUID(),
    production_id: record.production.id,
    stage: 'PRINTING',
  })
  const orderNumber = `OP-${String(record.production.id).padStart(5, '0')}`
  await page.goto(`/cases/${record.id}?production_id=${record.production.id}&tab=activity`)
  await expect(page.getByRole('button', { name: 'Actividad', exact: true })).toHaveClass(/active/)
  await expect(page.locator('.production-path')).toContainText(orderNumber)
  await expect(
    page.locator('.production-path').getByRole('button', { name: 'Confirmar trabajo terminado' }),
  ).toBeVisible()
  await expect(
    page.locator('.case-main').getByRole('button', { name: 'Confirmar trabajo terminado' }),
  ).toHaveCount(0)
  await page.screenshot({ path: '../.runtime/manual-top-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  const mobileConfirm = page
    .locator('.production-path')
    .getByRole('button', { name: 'Confirmar trabajo terminado' })
  await expect(mobileConfirm).toBeVisible()
  await mobileConfirm.focus()
  await expect(mobileConfirm).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.screenshot({ path: '../.runtime/manual-top-mobile.png' })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page
    .locator('.production-path')
    .getByRole('button', { name: 'Confirmar trabajo terminado' })
    .click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText(
    `¿Confirmar que el trabajo de ${orderNumber} está físicamente terminado?`,
  )
  await page.route(`**/api/cases/${record.id}/production/confirm-finished`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800))
    await route.continue()
  })
  await dialog.getByRole('button', { name: 'Confirmar trabajo terminado' }).click()
  await expect(dialog.getByRole('button', { name: 'Confirmando…' })).toBeDisabled()
  await expect(
    page.locator('.production-path').getByRole('button', { name: 'Confirmando…' }),
  ).toBeDisabled()
  await expect(dialog).toContainText(
    'Trabajo terminado confirmado. Las órdenes del grupo están listas para entregar.',
  )
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Confirmar trabajo terminado' })).toHaveCount(0)
  await expect(page.getByText('Listo para entregar').first()).toBeVisible()
  const updated = await (
    await page.request.get(`/api/cases/${record.id}?production_id=${record.production.id}`)
  ).json()
  expect(updated.production.stage).toBe('READY')
  expect(updated.deliveries).toHaveLength(0)
  expect(
    updated.events.filter((entry) => entry.data?.action === 'work_finished_confirmed'),
  ).toHaveLength(1)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('img', { name: 'Emblema de Comgraf' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Mi día' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  expect(errors).toEqual([])
})

test('dos OP comparten selector, confirmación manual, QR y aviso de pendientes', async ({
  page,
  browser,
}) => {
  await page.goto('/')
  await page.getByLabel('Usuario', { exact: true }).fill(credentials.username)
  await page.getByLabel('Contraseña', { exact: true }).fill(credentials.password)
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Mi día', exact: true })).toBeVisible()
  async function post(url, data) {
    const response = await page.request.post('/api' + url, { headers, data })
    expect(response.ok(), await response.text()).toBeTruthy()
    return response.json()
  }
  const client = await post('/clients', { name: 'E2E · Dos OP ' + Date.now() })
  let record = await post('/cases', {
    client_id: client.id,
    subject: 'E2E · Grupo mixto',
    kind: 'Solicitud',
    creation_context: 'personal',
  })
  record = await post(`/cases/${record.id}/take`, { version: record.version, key: randomUUID() })
  const conversion = (version) => ({
    version,
    key: randomUUID(),
    committed_date: '2099-12-31',
    payment_due_date: '2099-12-31',
    delivery_method: 'Retiro en taller',
    advance_required: '0',
    payment_terms: 'Contado',
    items: [
      {
        product: 'Tarjetas de presentación',
        quantity: '100',
        unit: 'unidades',
        unit_price: '10.00',
        specs: { width: '9', height: '5', material: 'Couché 300 g', sides: '2', inks: 'CMYK' },
      },
    ],
  })
  const first = await post(`/cases/${record.id}/convert`, conversion(record.version))
  const second = await post(`/cases/${record.id}/convert`, conversion(first.version))
  record = await post(`/cases/${record.id}/production/stage`, {
    version: second.version,
    key: randomUUID(),
    production_id: first.production.id,
    stage: 'PRINTING',
  })
  record = await post(`/cases/${record.id}/production/stage`, {
    version: record.version,
    key: randomUUID(),
    production_id: second.production.id,
    stage: 'PRINTING',
  })
  await page.goto(`/cases/${record.id}?production_id=${first.production.id}&tab=activity`)
  const pathBlock = page.locator('.production-path')
  const selector = pathBlock.getByRole('combobox', { name: 'Orden de producción seleccionada' })
  await expect(selector).toHaveValue(String(first.production.id))
  await page.screenshot({ path: '../.runtime/multi-order-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(selector).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.screenshot({ path: '../.runtime/multi-order-mobile.png' })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await pathBlock.getByRole('button', { name: 'Confirmar trabajo terminado' }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirmar trabajo terminado' })
    .click()
  await expect(page.getByRole('dialog')).toContainText('Pendiente de completar las demás órdenes.')
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar', exact: true }).click()
  await expect(pathBlock).toContainText('Trabajo terminado confirmado')
  await expect(
    pathBlock.getByRole('button', { name: second.production.order_number }),
  ).toBeVisible()
  await expect(pathBlock.getByRole('button', { name: 'Confirmar trabajo terminado' })).toHaveCount(
    0,
  )
  await pathBlock.getByRole('button', { name: second.production.order_number }).click()
  await expect(selector).toHaveValue(String(second.production.id))
  await expect(page).toHaveURL(/tab=activity/)
  await expect(pathBlock.getByRole('button', { name: 'Confirmar trabajo terminado' })).toBeVisible()
  await page.getByRole('button', { name: 'Producción', exact: true }).click()
  await expect(
    page.locator('.case-main').getByRole('button', { name: 'Confirmar trabajo terminado' }),
  ).toHaveCount(0)
  await expect(page.locator('.case-main')).toContainText(second.production.order_number)

  const scannerContext = await browser.newContext({ baseURL: new URL(page.url()).origin })
  const scannerPage = await scannerContext.newPage()
  await scannerPage.goto('/')
  await scannerPage.getByLabel('Usuario', { exact: true }).fill(credentials.scanner_username)
  await scannerPage.getByLabel('Contraseña', { exact: true }).fill(credentials.scanner_password)
  await scannerPage.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
  await expect(
    scannerPage.getByRole('heading', { name: 'Escáner de trabajo terminado' }),
  ).toBeVisible()
  const scanned = await scannerPage.request.post('/api/scanner/scan', {
    headers,
    data: { scan_id: `CGOP1:${second.production.scan_id}` },
  })
  expect(scanned.ok(), await scanned.text()).toBeTruthy()
  expect((await scanned.json()).result).toBe('released')
  await scannerContext.close()
  await page.reload()
  await expect(pathBlock).toContainText('Listo para entregar')
  await expect(pathBlock.getByRole('button', { name: 'Confirmar trabajo terminado' })).toHaveCount(
    0,
  )
  await selector.selectOption(String(first.production.id))
  await expect(pathBlock).toContainText('Listo para entregar')
  const final = await (
    await page.request.get(`/api/cases/${record.id}?production_id=${first.production.id}`)
  ).json()
  expect(final.productions.map((order) => order.stage)).toEqual(['READY', 'READY'])
  expect(
    final.events.filter((entry) => entry.data?.action === 'work_finished_confirmed'),
  ).toHaveLength(1)
  expect(
    final.events.filter((entry) => entry.data?.action === 'binding_scan_confirmed'),
  ).toHaveLength(1)
  expect(final.deliveries).toHaveLength(0)
})
