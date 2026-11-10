import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const credentials = JSON.parse(fs.readFileSync(path.resolve('../.runtime/e2e.json'), 'utf8'))
const headers = { 'X-Comgraf-Request': '1', 'X-Comgraf-Contract': '5', 'X-Comgraf-Build': '1.5.0' }

test('Producción crea Talonario CAI con cliente existente', async ({ page }) => {
  const name = `E2E CAI existente ${Date.now()}`
  await page.goto('/')
  await page.getByLabel('Usuario', { exact: true }).fill(credentials.username)
  await page.getByLabel('Contraseña', { exact: true }).fill(credentials.password)
  await page.getByRole('button', { name: 'Iniciar sesión' }).click()
  await expect(page.getByRole('heading', { name: 'Mi día' })).toBeVisible()
  const clientResponse = await page.request.post('/api/clients', { headers, data: { name } })
  expect(clientResponse.status()).toBe(201)
  await page.goto('/inbox/production')
  await page.getByRole('button', { name: 'Generar orden de producción' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('combobox', { name: /Cliente/ }).fill(name)
  await dialog.getByRole('option', { name }).click()
  await dialog.getByLabel('Asunto').fill(`OP Talonario CAI ${Date.now()}`)
  await dialog.getByLabel('Producto').selectOption('Talonario CAI')
  await expect(dialog.getByLabel('Cantidad de talonarios')).toHaveValue('1')
  await dialog.getByLabel('Cantidad de talonarios').fill('0')
  await dialog.getByLabel('Producto').selectOption('Talonarios y facturas')
  await dialog.getByLabel('Producto').selectOption('Talonario CAI')
  await expect(dialog.getByLabel('Cantidad de talonarios')).toHaveValue('0')
  await dialog.getByLabel('Cantidad de talonarios').fill('1')
  await dialog.getByLabel('Tipo de encuadernación').selectOption('Engrapado')
  const responsePromise = page.waitForResponse((response) =>
    response.url().endsWith('/api/production-requests'),
  )
  await dialog.getByRole('button', { name: 'Crear solicitud y orden' }).click()
  const response = await responsePromise
  const capture = {
    endpoint: new URL(response.url()).pathname,
    status: response.status(),
    contentType: response.headers()['content-type'],
    payload: response.request().postDataJSON(),
    response: (await response.text()).slice(0, 3000),
  }
  fs.writeFileSync(
    path.resolve('../.runtime/production-cai-repro.json'),
    JSON.stringify(capture, null, 2),
  )
  await page.screenshot({ path: '../.runtime/production-cai-repro.png', fullPage: true })
  expect(response.status()).toBe(201)
  await expect(dialog.getByText('Orden creada en Aprobación.')).toBeVisible()
  const created = await response.json()
  await dialog.getByRole('button', { name: 'Mantener en Aprobación' }).click()
  await expect(page.locator('.order-preview-sheet')).toContainText('Talonario CAI')
  await page.goto(`/cases/${created.id}/print?production_id=${created.production.id}`)
  await expect(page.locator('.cai-print')).toContainText('Talonario CAI')
  await expect(page.getByRole('img', { name: /QR estable de la orden/ })).toBeVisible()
  await page.screenshot({ path: '../.runtime/production-cai-created-print.png', fullPage: true })
})

for (const scenario of [
  {
    label: 'alta rápida, 50 juegos, crédito, entrega, fechas y precio positivo',
    newClient: true,
    games: 50,
    payment: 'Crédito',
    delivery: 'Entrega',
    dates: true,
    price: '125',
  },
  {
    label: 'cliente existente, 10 juegos, crédito, retiro, sin fechas y precio positivo',
    newClient: false,
    games: 10,
    payment: 'Crédito',
    delivery: 'Retiro en local',
    dates: false,
    price: '125',
  },
  {
    label: 'alta rápida, 10 juegos, contado, entrega, fechas y precio cero',
    newClient: true,
    games: 10,
    payment: 'Contado',
    delivery: 'Entrega',
    dates: true,
    price: '0',
  },
]) {
  test(`Producción crea Talonario CAI: ${scenario.label}`, async ({ page }) => {
    const name = `E2E CAI ${Date.now()}`
    await page.goto('/')
    await page.getByLabel('Usuario', { exact: true }).fill(credentials.username)
    await page.getByLabel('Contraseña', { exact: true }).fill(credentials.password)
    await page.getByRole('button', { name: 'Iniciar sesión' }).click()
    await expect(page.getByRole('heading', { name: 'Mi día' })).toBeVisible()
    if (!scenario.newClient) {
      const clientResponse = await page.request.post('/api/clients', { headers, data: { name } })
      expect(clientResponse.status()).toBe(201)
    }
    await page.goto('/inbox/production')
    await page.getByRole('button', { name: 'Generar orden de producción' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('combobox', { name: /Cliente/ }).fill(name)
    if (scenario.newClient) {
      await dialog.getByRole('button', { name: /Crear cliente/ }).click()
      await dialog.getByLabel('Empresa / razón social').fill('Cliente ficticio de prueba')
      await dialog.getByRole('button', { name: 'Crear y seleccionar cliente' }).click()
    } else {
      await dialog.getByRole('option', { name }).click()
    }
    await dialog.getByLabel('Asunto').fill(`OP Talonario CAI ${Date.now()}`)
    await dialog.getByLabel('Producto').selectOption('Talonario CAI')
    await dialog.getByLabel('Cantidad de talonarios').fill('1')
    if (scenario.games === 10) {
      await dialog.getByLabel('Juegos por talonario', { exact: true }).selectOption('other')
      await dialog.getByLabel('Cantidad de juegos por talonario').fill('10')
    } else {
      await dialog.getByLabel('Juegos por talonario', { exact: true }).selectOption('50')
    }
    await dialog.getByLabel('Tipo de encuadernación').selectOption('Engrapado')
    await dialog.getByLabel('Precio por talonario (HNL)').fill(scenario.price)
    await dialog.getByRole('radio', { name: scenario.payment }).check()
    await dialog.getByRole('radio', { name: scenario.delivery, exact: true }).check()
    if (scenario.dates) {
      await dialog.getByLabel('Fecha solicitada').fill('2099-12-30')
      await dialog.getByLabel('Fecha comprometida').fill('2099-12-31')
      await dialog.getByLabel('Vencimiento del saldo (si está acordado)').fill('2099-12-31')
    }
    const responsePromise = page.waitForResponse((response) =>
      response.url().endsWith('/api/production-requests'),
    )
    await dialog.getByRole('button', { name: 'Crear solicitud y orden' }).click()
    const response = await responsePromise
    const capture = {
      endpoint: new URL(response.url()).pathname,
      status: response.status(),
      contentType: response.headers()['content-type'],
      payload: response.request().postDataJSON(),
      response: (await response.text()).slice(0, 3000),
    }
    fs.writeFileSync(
      path.resolve(
        `../.runtime/production-cai-${scenario.games}-${scenario.newClient ? 'new' : 'existing'}.json`,
      ),
      JSON.stringify(capture, null, 2),
    )
    await page.screenshot({
      path: `../.runtime/production-cai-${scenario.games}-${scenario.newClient ? 'new' : 'existing'}.png`,
      fullPage: true,
    })
    expect(response.status(), capture.response).toBe(201)
    const record = await response.json()
    expect(record.owner_id).toBeNull()
    expect(record.production.stage).toBe('APPROVAL')
    expect(record.items[0].product).toBe('Talonario CAI')
    expect(record.items[0].quantity).toBe('1.000')
    expect(record.items[0].specs.games_per_pad).toBe(scenario.games)
    await expect(dialog.getByText('Orden creada en Aprobación.')).toBeVisible()
  })
}

test('respuesta ilegible después de guardar permite reintentar la misma OP sin duplicarla', async ({
  page,
}) => {
  const name = `E2E CAI reintento ${Date.now()}`
  await page.goto('/')
  await page.getByLabel('Usuario', { exact: true }).fill(credentials.username)
  await page.getByLabel('Contraseña', { exact: true }).fill(credentials.password)
  await page.getByRole('button', { name: 'Iniciar sesión' }).click()
  await expect(page.getByRole('heading', { name: 'Mi día' })).toBeVisible()
  const client = await page.request.post('/api/clients', { headers, data: { name } })
  expect(client.status()).toBe(201)
  const customer = await client.json()
  const payloads = [],
    savedIds = []
  await page.route('**/api/production-requests', async (route) => {
    payloads.push(route.request().postDataJSON())
    const upstream = await route.fetch()
    expect(upstream.status()).toBe(201)
    savedIds.push((await upstream.json()).id)
    if (payloads.length === 1) {
      await route.fulfill({
        status: 201,
        contentType: 'text/html',
        body: '<html>respuesta interrumpida</html>',
      })
    } else {
      await route.fulfill({ response: upstream })
    }
  })
  await page.goto('/inbox/production')
  await page.getByRole('button', { name: 'Generar orden de producción' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('combobox', { name: /Cliente/ }).fill(name)
  await dialog.getByRole('option', { name }).click()
  await dialog.getByLabel('Asunto').fill(`Reintento CAI ${Date.now()}`)
  await dialog.getByLabel('Producto').selectOption('Talonario CAI')
  await dialog.getByLabel('Tipo de encuadernación').selectOption('Engrapado')
  await dialog.getByRole('button', { name: 'Crear solicitud y orden' }).click()
  await expect(dialog.getByRole('alert')).toContainText('no se pudo confirmar su respuesta')
  await expect(dialog.getByLabel('Cantidad de talonarios')).toHaveValue('1')
  await expect(dialog.getByRole('button', { name: 'Crear solicitud y orden' })).toBeEnabled()
  await page.screenshot({ path: '../.runtime/production-cai-retry-error.png' })
  await dialog.getByRole('button', { name: 'Crear solicitud y orden' }).click()
  await expect(dialog.getByText('Orden creada en Aprobación.')).toBeVisible()
  expect(savedIds).toHaveLength(2)
  expect(savedIds[0]).toBe(savedIds[1])
  expect(payloads[0].key).toBe(payloads[1].key)
  const stored = await (await page.request.get(`/api/cases/${savedIds[0]}`)).json()
  expect(stored.client_id).toBe(customer.id)
  expect(stored.production.stage).toBe('APPROVAL')
  expect(stored.productions).toHaveLength(1)
})
