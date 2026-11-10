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

async function decodedPreviewQr(page) {
  if (!(await page.evaluate(() => Boolean(window.ZXingBrowser)))) {
    await page.addScriptTag({ url: '/qr-test-decoder.js' })
  }
  const image = page.locator('.order-preview-sheet .order-qr img')
  await expect
    .poll(() => image.evaluate((element) => element.complete && element.naturalWidth > 0))
    .toBe(true)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await page.evaluate(async () => {
        const reader = new window.ZXingBrowser.BrowserQRCodeReader()
        const result = await reader.decodeFromImageElement(
          document.querySelector('.order-preview-sheet .order-qr img'),
        )
        return result.getText()
      })
    } catch (error) {
      if (attempt === 2) throw error
      await page.waitForTimeout(150)
    }
  }
}

test('historial, pestañas, vista previa e impresión conservan la OP seleccionada', async ({
  page,
}) => {
  test.setTimeout(180000)
  await page.route('**/qr-test-decoder.js', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: fs.readFileSync(path.resolve('node_modules/@zxing/browser/umd/zxing-browser.min.js')),
    }),
  )
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
          detail: 'Original y copias',
        },
      },
    ],
  })
  const firstOrder = first.production
  const secondOrder = second.production
  expect(firstOrder.id).not.toBe(secondOrder.id)
  const beforeFirst = await caseState(page, record.id, firstOrder.id)
  const beforeSecond = await caseState(page, record.id, secondOrder.id)

  await page.goto(`/cases/${record.id}?production_id=${firstOrder.id}`)
  await expect(page.getByRole('button', { name: 'Producción', exact: true })).toHaveClass(/active/)
  await expect(
    page.getByRole('heading', { name: `Vista previa · ${firstOrder.order_number}` }),
  ).toBeVisible()
  await expect(page.locator('.order-preview-sheet')).toContainText('Instrucciones de la primera OP')
  const firstQr = page
    .locator('.order-preview-sheet')
    .getByRole('img', { name: `QR estable de la orden ${firstOrder.order_number}` })
  await expect(firstQr).toBeVisible()
  expect(await decodedPreviewQr(page)).toBe(`CGOP1:${firstOrder.scan_id}`)
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
  await expect(page.locator('.order-preview-sheet')).toHaveClass(/cai-print/)
  await expect(page.locator('.order-preview-sheet')).toContainText('Media carta')
  await expect(page.locator('.order-preview-sheet')).not.toContainText(
    'Instrucciones de la primera OP',
  )
  const secondQr = page
    .locator('.order-preview-sheet')
    .getByRole('img', { name: `QR estable de la orden ${secondOrder.order_number}` })
  await expect(secondQr).toBeVisible()
  expect(await decodedPreviewQr(page)).toBe(`CGOP1:${secondOrder.scan_id}`)
  await page.screenshot({ path: '../.runtime/order-preview-cai.png', fullPage: true })

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
  await expect(printPage.locator('.cai-print')).toBeVisible()
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
  await expect(page.locator('.print-sheet')).toHaveClass(/cai-print/)
  await expect(page.locator('.print-sheet')).toContainText(secondOrder.order_number)
  await expect(page.locator('.print-sheet')).toContainText('Comunicación Gráfica')
  await expect(page.locator('.print-sheet>header')).not.toContainText(/comgraf/i)
  await expect(page.locator('.print-sheet')).not.toContainText(firstOrder.order_number)
  const caiLogo = page.locator('.cai-print-brand img[src="/branding/comgraf-logo.png"]')
  await expect(caiLogo).toBeVisible()
  expect(await caiLogo.evaluate((image) => image.naturalWidth)).toBeGreaterThan(10)
  await expect(
    page
      .locator('.print-sheet')
      .getByRole('img', { name: `QR estable de la orden ${secondOrder.order_number}` }),
  ).toBeVisible()
  await page.screenshot({ path: '../.runtime/qa-print-cai.png', fullPage: true })
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
})
