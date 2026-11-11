import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import QRCode from 'qrcode'
import { PNG } from 'pngjs'
import fs from 'node:fs'
import path from 'node:path'

const credentials = JSON.parse(fs.readFileSync(path.resolve('../.runtime/e2e.json'), 'utf8'))
const headers = { 'X-Comgraf-Request': '1', 'X-Comgraf-Contract': '5', 'X-Comgraf-Build': '1.4.0' }

async function post(page, url, data) {
  const response = await page.request.post(url, { headers, data })
  expect(response.ok(), `${url}: ${await response.text()}`).toBeTruthy()
  return response.json()
}

async function caseState(page, caseId, orderId) {
  const response = await page.request.get(`/api/cases/${caseId}?production_id=${orderId}`)
  expect(response.ok()).toBeTruthy()
  const record = await response.json()
  return {
    version: record.version,
    productions: record.productions.map(
      ({ id, stage, workflow_cycle, cancelled_at, delivery_status }) => ({
        id,
        stage,
        workflow_cycle,
        cancelled_at,
        delivery_status,
      }),
    ),
    deliveries: record.deliveries,
    ledger: record.ledger,
  }
}

async function expectPreviewQr(page, scanId) {
  const expected = await QRCode.toDataURL(`CGOP1:${scanId}`, {
    errorCorrectionLevel: 'M',
    margin: 4,
    width: 320,
    color: { dark: '#000000', light: '#ffffff' },
  })
  const source = await page
    .locator('.order-preview-sheet .order-qr img')
    .first()
    .getAttribute('src')
  expect(source).toMatch(/^data:image\/png;base64,/)
  const actualPixels = PNG.sync.read(Buffer.from(source.split(',')[1], 'base64'))
  const expectedPixels = PNG.sync.read(Buffer.from(expected.split(',')[1], 'base64'))
  expect(actualPixels.width).toBe(expectedPixels.width)
  expect(actualPixels.height).toBe(expectedPixels.height)
  expect(actualPixels.data.equals(expectedPixels.data)).toBe(true)
}

test('historial, pestañas, vista previa e impresión conservan la OP seleccionada', async ({
  page,
}) => {
  test.setTimeout(180000)
  await page.goto('/')
  await page.getByLabel('Usuario', { exact: true }).fill(credentials.username)
  await page.getByLabel('Contraseña', { exact: true }).fill(credentials.password)
  await page.getByRole('button', { name: 'Iniciar sesión' }).click()
  await expect(page.getByRole('heading', { name: 'Mi día' })).toBeVisible()

  const client = await post(page, '/api/clients', { name: `Prueba de impresión ${Date.now()}` })
  let record = await post(page, '/api/cases', {
    client_id: client.id,
    subject: 'Dos órdenes con vista previa',
    kind: 'Solicitud',
    creation_context: 'personal',
  })
  record = await post(page, `/api/cases/${record.id}/take`, {
    version: record.version,
    key: randomUUID(),
  })

  const common = { payment_due_date: '2099-01-01', delivery_method: 'Retiro en taller' }
  const first = await post(page, `/api/cases/${record.id}/convert`, {
    ...common,
    version: record.version,
    key: randomUUID(),
    instructions: 'Instrucciones de la primera OP',
    items: [
      {
        product: 'Banners y lonas',
        quantity: '2',
        unit: 'unidades',
        unit_price: '250',
        specs: { measure_unit: 'cm', width: '100', height: '200', material: 'Lona 13 oz' },
      },
    ],
  })
  const second = await post(page, `/api/cases/${record.id}/convert`, {
    ...common,
    version: first.version,
    key: randomUUID(),
    instructions: 'Instrucciones CAI de la segunda OP',
    items: [
      {
        product: 'Talonarios de factura CAI',
        quantity: '10',
        unit: 'talonarios',
        unit_price: '125',
        specs: {
          cai_format: 'Media carta',
          games_per_pad: 50,
          paper_type: 'Químico',
          additional_copies: 2,
          cai_binding: 'Engrapado',
          fiscal_document_type: 'Factura',
          detail: 'Original y copias',
        },
      },
    ],
  })
  const firstOrder = first.production
  const secondOrder = second.production
  const third = await post(page, `/api/cases/${record.id}/convert`, {
    ...common,
    version: second.version,
    key: randomUUID(),
    instructions: 'OP mixta con dos familias',
    items: [
      {
        product: 'Talonario CAI',
        quantity: '1',
        unit: 'talonarios',
        unit_price: '0',
        specs: {
          cai_format: 'Carta',
          games_per_pad: 10,
          paper_type: 'Bond',
          additional_copies: 1,
          cai_binding: 'Pegado',
          fiscal_document_type: 'Nota de crédito',
        },
      },
      {
        product: 'Volantes y flyers',
        quantity: '250',
        unit: 'unidades',
        unit_price: '0',
        specs: { width: '10', height: '15', measure_unit: 'cm', material: 'Couché' },
      },
    ],
  })
  const thirdOrder = third.production
  expect(firstOrder.id).not.toBe(secondOrder.id)
  expect(thirdOrder.id).not.toBe(secondOrder.id)
  const beforeFirst = await caseState(page, record.id, firstOrder.id)
  const beforeSecond = await caseState(page, record.id, secondOrder.id)
  const beforeThird = await caseState(page, record.id, thirdOrder.id)

  await page.goto(`/cases/${record.id}?production_id=${firstOrder.id}`)
  await expect(page.getByRole('button', { name: 'Producción', exact: true })).toHaveClass(/active/)
  await expect(
    page.getByRole('heading', { name: `Vista previa · ${firstOrder.order_number}` }),
  ).toBeVisible()
  await expect(page.locator('.case-order-entry')).toHaveCount(3)
  await expect(page.locator('.case-order-entry').nth(2)).toContainText('Talonario CAI')
  await expect(page.locator('.case-order-entry').nth(2)).toContainText('Volantes y flyers')
  await expect(page.locator('.order-preview-sheet')).toContainText('Instrucciones de la primera OP')
  const firstQr = page
    .locator('.order-preview-sheet')
    .getByRole('img', { name: `QR estable de la orden ${firstOrder.order_number}` })
    .first()
  await expect(firstQr).toBeVisible()
  await expectPreviewQr(page, firstOrder.scan_id)
  await page.screenshot({ path: '../.runtime/order-preview-normal.png', fullPage: true })
  await page.reload()
  await expect(
    page.getByRole('heading', { name: `Vista previa · ${firstOrder.order_number}` }),
  ).toBeVisible()

  const orderSelector = page.getByRole('combobox', { name: 'Orden de producción seleccionada' })
  await expect(orderSelector).toHaveValue(String(firstOrder.id))
  let delayedSelection = true
  await page.route(
    (url) =>
      url.pathname === `/api/cases/${record.id}` &&
      url.searchParams.get('production_id') === String(secondOrder.id),
    async (route) => {
      if (delayedSelection) {
        delayedSelection = false
        await new Promise((resolve) => setTimeout(resolve, 600))
      }
      await route.continue()
    },
  )
  await orderSelector.selectOption(String(secondOrder.id))
  await expect(page.locator('.production-path')).toHaveCount(0)
  await expect(page.locator('.order-preview-sheet')).toHaveCount(0)
  await expect(page).toHaveURL(new RegExp(`production_id=${secondOrder.id}`))
  await expect(orderSelector).toHaveValue(String(secondOrder.id))
  await expect(
    page.getByRole('heading', { name: `Vista previa · ${secondOrder.order_number}` }),
  ).toBeVisible()
  await expect(page.locator('.order-preview-sheet')).toHaveClass(/order-sheet/)
  await expect(page.locator('.order-preview-sheet')).toContainText('Media carta')
  await expect(page.locator('.order-preview-sheet')).not.toContainText(
    'Instrucciones de la primera OP',
  )
  const secondQr = page
    .locator('.order-preview-sheet')
    .getByRole('img', { name: `QR estable de la orden ${secondOrder.order_number}` })
    .first()
  await expect(secondQr).toBeVisible()
  await expectPreviewQr(page, secondOrder.scan_id)
  await page.screenshot({ path: '../.runtime/order-preview-cai.png', fullPage: true })

  await page.locator('.case-order-entry').nth(2).getByRole('button', { name: 'Ver orden' }).click()
  await expect(page).toHaveURL(new RegExp(`production_id=${thirdOrder.id}`))
  await expect(page.locator('.case-order-entry.selected')).toContainText(thirdOrder.order_number)
  const mixedItems = page.locator('.order-preview-sheet .order-sheet-item')
  await expect(mixedItems).toHaveCount(2)
  await expect(mixedItems.nth(0)).toContainText('Nota de crédito')
  await expect(mixedItems.nth(0)).toContainText('Cantidad de talonarios')
  await expect(mixedItems.nth(1)).toContainText('250 unidades')
  await expect(mixedItems.nth(1)).not.toContainText('Cantidad de talonarios')
  await expect(mixedItems.nth(1)).not.toContainText('Tipo de documento fiscal')
  await expectPreviewQr(page, thirdOrder.scan_id)
  await orderSelector.selectOption(String(secondOrder.id))
  await expect(page.locator('.order-preview-sheet')).toContainText(secondOrder.order_number)

  const printLink = page
    .locator('a[target="_blank"]')
    .filter({ hasText: 'Imprimir orden de producción' })
  await expect(printLink).toHaveAttribute(
    'href',
    `/cases/${record.id}/print?production_id=${secondOrder.id}`,
  )
  const popupPromise = page.waitForEvent('popup')
  await printLink.click()
  const printPage = await popupPromise
  await expect(printPage.locator('.order-sheet')).toBeVisible()
  await printPage.pdf({
    path: '../.runtime/order-preview-cai.pdf',
    preferCSSPageSize: true,
    printBackground: true,
  })
  await printPage.close()
  await page.goto(`/cases/${record.id}?production_id=${secondOrder.id}&tab=production`)
  await page.getByRole('button', { name: /^Archivos/ }).click()
  await expect(page.getByRole('button', { name: /^Archivos/ })).toHaveClass(/active/)
  await expect(orderSelector).toHaveValue(String(secondOrder.id))
  await page.waitForTimeout(16000)
  await expect(page.getByRole('button', { name: /^Archivos/ })).toHaveClass(/active/)
  await page.goBack()
  await expect(
    page.getByRole('heading', { name: `Vista previa · ${secondOrder.order_number}` }),
  ).toBeVisible()
  await page.goForward()
  await expect(page.getByRole('button', { name: /^Archivos/ })).toHaveClass(/active/)
  await expect(orderSelector).toHaveValue(String(secondOrder.id))

  await page.goto(`/cases/${record.id}?tab=activity`)
  await expect(orderSelector).toHaveValue(String(firstOrder.id))
  await page.getByRole('link', { name: `Orden ${firstOrder.order_number}` }).click()
  await expect(orderSelector).toHaveValue(String(firstOrder.id))
  await expect(
    page.getByRole('heading', { name: `Vista previa · ${firstOrder.order_number}` }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Actividad', exact: true }).click()
  await page.getByRole('link', { name: `Orden ${secondOrder.order_number}` }).click()
  await expect(orderSelector).toHaveValue(String(secondOrder.id))
  await expect(
    page.getByRole('heading', { name: `Vista previa · ${secondOrder.order_number}` }),
  ).toBeVisible()

  await page.goto(`/cases/${record.id}/print?production_id=${secondOrder.id}`)
  await expect(page.locator('.print-sheet')).toHaveClass(/order-sheet/)
  await expect(page.locator('.print-sheet')).toContainText(secondOrder.order_number)
  await expect(page.locator('.print-sheet')).toContainText('Comunicación Gráfica')
  await expect(page.locator('.order-sheet-header')).not.toContainText(/comgraf/i)
  await expect(page.locator('.print-sheet')).not.toContainText(firstOrder.order_number)
  const caiLogo = page.locator('.order-sheet-brand img[src="/branding/comgraf-logo.png"]')
  await expect(caiLogo).toBeVisible()
  expect(await caiLogo.evaluate((image) => image.naturalWidth)).toBeGreaterThan(10)
  await expect(
    page
      .locator('.print-sheet')
      .getByRole('img', { name: `QR estable de la orden ${secondOrder.order_number}` })
      .first(),
  ).toBeVisible()
  const printPicker = page.getByRole('combobox', { name: 'Orden de producción para imprimir' })
  await printPicker.selectOption(String(thirdOrder.id))
  await expect(page.locator('.print-sheet')).toContainText('Volantes y flyers')
  await expect(page.locator('.print-sheet')).toContainText(thirdOrder.order_number)
  await page.goBack()
  await expect(page.locator('.print-sheet')).toContainText(secondOrder.order_number)
  await page.screenshot({ path: '../.runtime/qa-print-cai.png', fullPage: true })
  await page.goto(`/cases/${record.id}/print`)
  await expect(page).toHaveURL(new RegExp(`production_id=${firstOrder.id}`))
  await expect(page.locator('.print-sheet')).toContainText(firstOrder.order_number)
  await page.goto(`/cases/${record.id}`)
  await expect(page.getByRole('button', { name: 'Actividad', exact: true })).toHaveClass(/active/)
  await expect(orderSelector).toHaveValue(String(firstOrder.id))
  await orderSelector.selectOption(String(secondOrder.id))
  await expect(page.getByRole('button', { name: 'Actividad', exact: true })).toHaveClass(/active/)
  await expect(page).toHaveURL(new RegExp(`production_id=${secondOrder.id}&tab=activity`))
  await page.goBack()
  await expect(orderSelector).toHaveValue(String(firstOrder.id))
  await page.goto(`/cases/${record.id}?production_id=999999999&tab=production`)
  await expect(page.getByText('Orden de producción no encontrada en esta solicitud')).toBeVisible()
  await expect(page.locator('.order-preview-sheet')).toHaveCount(0)
  await page.goto(`/cases/${record.id}/print?production_id=999999999`)
  await expect(page.getByText('Orden de producción no encontrada en esta solicitud')).toBeVisible()
  await expect(page.locator('.print-sheet')).toHaveCount(0)

  expect(await caseState(page, record.id, firstOrder.id)).toEqual(beforeFirst)
  expect(await caseState(page, record.id, secondOrder.id)).toEqual(beforeSecond)
  expect(await caseState(page, record.id, thirdOrder.id)).toEqual(beforeThird)
})
