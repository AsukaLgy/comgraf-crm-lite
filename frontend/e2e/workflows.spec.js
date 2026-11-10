import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
const credentials = JSON.parse(fs.readFileSync(path.resolve('../.runtime/e2e.json'), 'utf8'))
const headers = { 'X-Comgraf-Request': '1', 'X-Comgraf-Contract': '5', 'X-Comgraf-Build': '1.4.0' }
let errors = []
test.beforeEach(async ({ page }) => {
  errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.getByLabel('Usuario', { exact: true }).fill(credentials.username)
  await page.getByLabel('Contraseña', { exact: true }).fill(credentials.password)
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Mi día', exact: true })).toBeVisible()
})
test.afterEach(() => expect(errors).toEqual([]))

async function createCase(page, subject) {
  const client = await page.request.post('/api/clients', {
    headers,
    data: { name: 'E2E · Cliente ' + Date.now() },
  })
  expect(client.ok()).toBeTruthy()
  const customer = await client.json()
  const response = await page.request.post('/api/cases', {
    headers,
    data: { client_id: customer.id, subject, kind: 'Cotización', creation_context: 'pool' },
  })
  expect(response.ok()).toBeTruthy()
  const record = await response.json()
  await page.goto('/cases/' + record.id)
  await page.getByRole('button', { name: 'Tomar solicitud', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Tomar solicitud', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  return record
}

async function scanAsOperator(page, qr) {
  const origin = new URL(page.url()).origin
  const context = await page.context().browser().newContext({ baseURL: origin })
  const scanner = await context.newPage()
  await scanner.goto('/')
  await scanner.getByLabel('Usuario', { exact: true }).fill(credentials.scanner_username)
  await scanner.getByLabel('Contraseña', { exact: true }).fill(credentials.scanner_password)
  await scanner.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
  await expect(scanner.getByRole('heading', { name: 'Escáner de trabajo terminado' })).toBeVisible()
  const response = await scanner.request.post('/api/scanner/scan', { headers, data: { scan_id: qr } })
  const result = { ok: response.ok(), data: await response.json() }
  await context.close()
  return result
}

test('el rol escáner entra a una terminal aislada y no lee expedientes completos', async ({ page }) => {
  await page.getByRole('button', { name: 'Cerrar sesión' }).click()
  await expect(page.getByRole('heading', { name: 'Entrar al espacio de trabajo' })).toBeVisible()
  await page.getByLabel('Usuario', { exact: true }).fill(credentials.scanner_username)
  await page.getByLabel('Contraseña', { exact: true }).fill(credentials.scanner_password)
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Escáner de trabajo terminado' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Emblema de Comgraf' })).toBeVisible()
  await expect(page.getByText('Escaneá el QR de la orden terminada.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Activar cámara' })).toBeVisible()
  await expect(page.getByRole('navigation')).toHaveCount(0)
  expect((await page.request.get('/api/cases')).status()).toBe(403)
  expect((await page.request.get('/api/users')).status()).toBe(403)
})

test('tomar un caso sin asignar desde la bandeja actualiza la fila', async ({ page }) => {
  const subject = 'E2E caso para tomar desde bandeja ' + Date.now()
  const clientResponse = await page.request.post('/api/clients', {
    headers,
    data: { name: 'E2E · Pool ' + Date.now() },
  })
  expect(clientResponse.ok()).toBeTruthy()
  const client = await clientResponse.json()
  const response = await page.request.post('/api/cases', {
    headers,
    data: { client_id: client.id, subject, kind: 'Cotización', creation_context: 'pool' },
  })
  expect(response.ok()).toBeTruthy()
  await page.goto('/inbox/pool')
  await expect(page.getByRole('button', { name: 'Filtros', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Guardar vista', exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Estado', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Modo', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Orden', { exact: true })).toBeVisible()
  const row = page.getByRole('row').filter({ hasText: subject })
  await row.getByRole('button', { name: 'Tomar solicitud' }).click()
  await expect(row).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Mis solicitudes/ })).toBeVisible()
  await page.getByRole('link', { name: /Mis solicitudes/ }).click()
  const mineRow = page.getByRole('row').filter({ hasText: subject })
  await expect(mineRow).toBeVisible()
  await page.reload()
  await expect(page.getByRole('row').filter({ hasText: subject })).toBeVisible()
})

test('búsqueda global funciona con el botón y con Enter', async ({ page }) => {
  await page.goto('/')
  const search = page.getByRole('textbox', { name: 'Búsqueda global' })
  await search.fill('noexiste-button-' + Date.now())
  await page.getByRole('button', { name: 'Buscar', exact: true }).click()
  await expect(page).toHaveURL(/\/search\?q=/)
  await expect(page.getByRole('heading', { name: 'Búsqueda global' })).toBeVisible()

  await search.fill('noexiste-enter-' + Date.now())
  await search.press('Enter')
  await expect(page).toHaveURL(/noexiste-enter-/)
  await expect(page.getByText(/Resultados para/)).toBeVisible()
})

test('anular con importe final calcula devolución y registra devolución real', async ({ page }) => {
  const record = await createCase(page, 'E2E Anulación comercial con devolución')
  const current = await (await page.request.get(`/api/cases/${record.id}`)).json()
  const convertedResponse = await page.request.post(`/api/cases/${record.id}/convert`, {
    headers,
    data: {
      version: current.version,
      key: `e2e-convert-${Date.now()}`,
      items: [
        {
          product: 'Tarjetas de presentación',
          quantity: '100',
          unit: 'unidades',
          unit_price: '10.00',
          specs: { width: '9', height: '5', material: 'Couché 300 g', sides: '2', inks: 'CMYK' },
        },
      ],
      currency: 'HNL',
      payment_terms: 'Contado',
      advance_required: '0.00',
      payment_due_date: '2099-12-31',
      delivery_method: 'Retiro en taller',
    },
  })
  expect(convertedResponse.ok()).toBeTruthy()
  const converted = await convertedResponse.json()
  const paidResponse = await page.request.post(`/api/cases/${record.id}/payments`, {
    headers,
    data: {
      version: converted.version,
      key: `e2e-payment-${Date.now()}`,
      amount: '300.00',
      kind: 'Anticipo',
      reference: 'Anticipo E2E',
    },
  })
  expect(paidResponse.ok()).toBeTruthy()

  await page.goto(`/cases/${record.id}`)
  await page.getByRole('button', { name: 'Producción', exact: true }).click()
  await page.getByRole('button', { name: 'Anular trabajo', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Motivo de anulación').fill('Se cancela antes de terminar el trabajo')
  await dialog.getByLabel('Tratamiento económico').selectOption('IMPORTE_FINAL')
  await dialog.getByLabel('Importe final acordado (HNL)').fill('200.00')
  await expect(dialog.getByText(/Pendiente de devolución/)).toBeVisible()
  await expect(dialog.getByText(/L\s*100\.00/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByText(/Pendiente de devolución/).first()).toBeVisible()

  await page.getByRole('button', { name: 'Entregas y cobros', exact: true }).click()
  await page.getByRole('button', { name: 'Registrar devolución' }).click()
  const refundDialog = page.getByRole('dialog')
  await expect(refundDialog.getByLabel(/Importe a devolver/)).toHaveValue('100.00')
  await refundDialog.getByLabel('Referencia de la devolución').fill('Transferencia devuelta E2E')
  await refundDialog.getByRole('button', { name: 'Guardar' }).click()
  await expect(refundDialog).toHaveCount(0)
  const final = await (await page.request.get(`/api/cases/${record.id}`)).json()
  expect(final.balance).toBe('0.00')
  expect(final.ledger.filter((entry) => entry.kind === 'Devolución')).toHaveLength(1)
})

test('solicitud sin producción se puede cerrar y completar', async ({ page }) => {
  const record = await createCase(page, 'E2E consultation without production')
  await expect(page.getByLabel(/Etapas de producci/)).toHaveCount(0)
  await page
    .getByLabel('Nota interna', { exact: true })
    .fill('Consultation handled; no production needed.')
  await page.getByRole('button', { name: 'Guardar nota', exact: true }).click()
  await expect(
    page.getByText('Consultation handled; no production needed.', { exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: /Cerrar atenci/ }).click()
  await page.getByRole('button', { name: 'Completar solicitud', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('p').filter({ hasText: 'La solicitud dejará' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Completar solicitud', exact: true }).click()
  await expect(page.getByText('Completado', { exact: true }).first()).toBeVisible()
  const completed = await (await page.request.get(`/api/cases/${record.id}`)).json()
  expect(completed.lifecycle).toBe('Completado')
  await page.getByRole('button', { name: 'Reactivar solicitud', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Completar solicitud', exact: true })).toBeVisible()
  const current = await (await page.request.get(`/api/cases/${record.id}`)).json()
  expect(current.lifecycle).toBe('Activo')
  expect(
    current.events.filter((event) =>
      ['case_completed', 'case_reactivated'].includes(event.data.action),
    ),
  ).toHaveLength(2)
})
test('borrador de nota sobrevive navegación sin tocar borradores históricos', async ({ page }) => {
  const record = await createCase(page, 'E2E Borrador de nota')
  await page.evaluate((caseId) => localStorage.setItem(`comgraf.draft.1.${caseId}.Correo`, 'Borrador histórico'), record.id)
  await page.getByLabel('Nota interna', { exact: true }).fill('Nota interna que nunca debe salir')
  await page.getByRole('link', { name: 'Mis solicitudes', exact: true }).click()
  await page.goto('/cases/' + record.id)
  await expect(page.getByLabel('Nota interna', { exact: true })).toHaveValue('Nota interna que nunca debe salir')
  await page.reload()
  await expect(page.getByLabel('Nota interna', { exact: true })).toHaveValue('Nota interna que nunca debe salir')
  expect(await page.evaluate((caseId) => localStorage.getItem(`comgraf.draft.1.${caseId}.Correo`), record.id)).toBe('Borrador histórico')
})

test('error real de validación conserva formulario y conversión mantiene expediente', async ({
  page,
}) => {
  const record = await createCase(page, 'E2E Conversión con recuperación de error')
  await page.getByRole('button', { name: 'Generar orden de producción', exact: true }).click()
  const d = page.getByRole('dialog')
  await d.getByLabel('Producto', { exact: true }).selectOption('Banners y lonas')
  await d.getByLabel('Cantidad', { exact: true }).fill('2')
  await d.getByLabel('Precio unitario (HNL)', { exact: true }).fill('250')
  await d.getByLabel('Ancho', { exact: true }).fill('1.25')
  await d.getByLabel('Alto', { exact: true }).fill('2.50')
  await d.getByLabel('Material / papel').fill('Lona 13 oz')
  await d.getByLabel('Anticipo requerido (HNL)').fill('1000')
  await d.getByLabel('Instrucciones de taller').fill('Ojillos cada 50 cm; conservar este texto')
  await d.getByRole('button', { name: /Generar orden de producción/ }).click()
  await expect(d.getByRole('alert')).toContainText('El anticipo no puede superar el precio')
  await expect(d.getByLabel('Instrucciones de taller')).toHaveValue(
    'Ojillos cada 50 cm; conservar este texto',
  )
  await expect(d.getByLabel('Ancho', { exact: true })).toHaveValue('1.25')
  await d.getByLabel('Anticipo requerido (HNL)').fill('0')
  await d.getByRole('button', { name: /Generar orden de producción/ }).click()
  await expect(d.getByText('Orden creada en Aprobación.')).toBeVisible()
  await d.getByRole('button', { name: 'Mantener en Aprobación' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page).toHaveURL(new RegExp('/cases/' + record.id + '\\?(?=.*production_id=\\d+)(?=.*tab=production)'))
  const stageBar = page.getByLabel('Etapas de producción')
  await expect(stageBar).toBeVisible()
  await expect(stageBar.locator('li').first()).not.toHaveClass(/done/)
  await expect(stageBar.locator('li').first().locator('svg')).toHaveCount(0)
  await page.getByRole('button', { name: 'Producción', exact: true }).click()
  await expect(
    page.getByRole('paragraph').filter({ hasText: 'Ojillos cada 50 cm; conservar este texto' }).first(),
  ).toBeVisible()
  const qrImage = page.getByRole('img', { name: /QR estable de la orden/ }).first()
  await expect(qrImage).toBeVisible()
  const qrSize = await qrImage.evaluate((image) => ({ width: image.naturalWidth, height: image.naturalHeight }))
  expect(qrSize.width).toBeGreaterThan(0)
  expect(qrSize.height).toBe(qrSize.width)
  await page.getByRole('link', { name: 'Imprimir orden de producción' }).first().click()
  await expect(page.getByText(/NO AUTORIZADA/)).toHaveCount(0)
  await expect(page.getByRole('img', { name: /QR estable de la orden/ })).toBeVisible()
  await page.screenshot({ path: '../.runtime/comgraf-ficha.png', fullPage: true })
})

test('una solicitud admite varias partidas por orden y varias órdenes independientes', async ({ page }) => {
  const record = await createCase(page, 'E2E Varias órdenes en un expediente')
  await page.getByRole('button', { name: 'Generar orden de producción', exact: true }).click()
  let dialog = page.getByRole('dialog')
  let items = dialog.locator('.item-editor')
  await items.nth(0).getByLabel('Producto', { exact: true }).selectOption('Banners y lonas')
  await items.nth(0).getByLabel('Precio unitario (HNL)').fill('250')
  await items.nth(0).getByLabel('Ancho').fill('1.25')
  await items.nth(0).getByLabel('Alto').fill('2.50')
  await items.nth(0).getByLabel('Material / papel').fill('Lona 13 oz')
  await dialog.getByRole('button', { name: 'Agregar producto', exact: true }).click()
  items = dialog.locator('.item-editor')
  await items.nth(1).getByLabel('Producto', { exact: true }).selectOption('Otros trabajos')
  await items.nth(1).getByLabel('Precio unitario (HNL)').fill('15')
  await items.nth(1).getByLabel('Especificaciones adicionales').fill('Paquete de tarjetas complementario')
  await dialog.getByRole('button', { name: /Generar orden de producción/ }).click()
  await dialog.getByRole('button', { name: 'Mantener en Aprobación' }).click()
  await expect(page).toHaveURL(new RegExp('/cases/' + record.id + '\\?(?=.*production_id=\\d+)(?=.*tab=production)'))
  await page.getByRole('button', { name: 'Producción', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Especificaciones de producción' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Banners y lonas', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Otros trabajos', exact: true })).toBeVisible()
  await expect(page.getByRole('img', { name: /QR estable de la orden/ }).first()).toBeVisible()
  const firstOrderUrl = page.url()
  await page.getByRole('button', { name: 'Agregar orden de producción', exact: true }).click()
  dialog = page.getByRole('dialog')
  items = dialog.locator('.item-editor')
  await items.nth(0).getByLabel('Producto', { exact: true }).selectOption('Talonarios y facturas')
  await items.nth(0).getByLabel('Formato').selectOption('Carta')
  await items.nth(0).getByLabel('Juegos por talonario').selectOption('50')
  await items.nth(0).getByLabel('Tipo de papel').selectOption('Bond')
  await items.nth(0).getByLabel('Número de copias').selectOption('1')
  await items.nth(0).getByLabel('Tipo de encuadernación').selectOption('Engrapado')
  await items.nth(0).getByLabel('Cantidad de talonarios').fill('2')
  await items.nth(0).getByLabel('Precio por talonario (HNL)').fill('20')
  await dialog.getByRole('button', { name: /Generar orden de producción/ }).click()
  await dialog.getByRole('button', { name: 'Pasar a Impresión', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Orden de producción seleccionada' }).locator('option')).toHaveCount(2)
  await expect(page.getByRole('heading', { name: 'Talonarios y facturas', exact: true })).toBeVisible()
  await expect(page.getByText('Etapa actual: Impresión')).toBeVisible()
  await page.goto(firstOrderUrl)
  await page.getByRole('button', { name: 'Producción', exact: true }).click()
  await expect(page.getByText('Etapa actual: Aprobación')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Banners y lonas', exact: true })).toBeVisible()
  const persisted = await (await page.request.get(`/api/cases/${record.id}`)).json()
  expect(persisted.production_count).toBe(2)
  expect(persisted.productions.map((order) => order.stage).sort()).toEqual(['APPROVAL', 'PRINTING'])
  expect(persisted.productions.map((order) => order.order_number).filter(Boolean)).toHaveLength(2)
  const productCounts = await Promise.all(persisted.productions.map(async (order) => {
    const details = await (await page.request.get(`/api/cases/${record.id}?production_id=${order.id}`)).json()
    return details.items.length
  }))
  expect(productCounts.sort()).toEqual([1, 2])
})

test('filtros y vistas conservados al volver desde el expediente', async ({ page }) => {
  const record = await createCase(page, 'E2E Filtros persistentes')
  await page.getByRole('link', { name: 'Mis solicitudes', exact: true }).click()
  await page.getByLabel('Estado', { exact: true }).selectOption('Abierto')
  await page.getByLabel('Modo', { exact: true }).selectOption('Atención')
  await page.getByLabel('Orden', { exact: true }).selectOption('oldest')
  await page.getByRole('button', { name: 'Guardar vista' }).click()
  await page.getByLabel('Nombre de la vista').fill('Mi atención nueva')
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar', exact: true }).click()
  await page.locator(`a[href^="/cases/${record.id}?"]`).click()
  await page.getByRole('button', { name: 'Volver a la bandeja' }).click()
  await expect(page.getByLabel('Estado', { exact: true })).toHaveValue('Abierto')
  await expect(page.getByLabel('Modo', { exact: true })).toHaveValue('Atención')
  await expect(page.getByLabel('Orden', { exact: true })).toHaveValue('oldest')
  await expect(page.getByRole('button', { name: 'Mi atención nueva', exact: true })).toBeVisible()
  await page.screenshot({ path: '../.runtime/comgraf-consola.png', fullPage: true })
})

test('crear cliente y caso desde formularios y encontrar su historial', async ({ page }) => {
  const name = 'E2E · Librería ' + Date.now()
  await page.getByRole('link', { name: 'Clientes', exact: true }).click()
  await page.getByRole('button', { name: 'Nuevo cliente' }).click()
  await page.getByRole('dialog').getByLabel('Nombre', { exact: true }).fill(name)
  await page.getByRole('dialog').getByLabel('Teléfonos (uno por línea)').fill('+504 9876-5432')
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar', exact: true }).click()
  await page.getByRole('link', { name, exact: true }).click()
  await page.getByRole('button', { name: 'Nueva solicitud', exact: true }).click()
  const newDialog = page.getByRole('dialog')
  await expect(newDialog.getByLabel('Tipo de atención', { exact: true })).toHaveValue('')
  expect(await newDialog.getByLabel('Tipo de atención', { exact: true }).locator('option').allTextContents()).toEqual([
    'Seleccionar tipo de atención', 'Cotización', 'Orden de producción', 'Reclamo',
  ])
  await expect(newDialog.getByLabel('Canal de origen')).toHaveCount(0)
  await expect(newDialog.getByLabel(/Solicitud relacionada/)).toHaveCount(0)
  await page
    .getByRole('dialog')
    .getByLabel('Asunto', { exact: true })
    .fill('Consulta de libretas para librería')
  await page.getByRole('dialog').getByLabel('Tipo de atención', { exact: true }).selectOption('Solicitud')
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Consulta de libretas para librería' }),
  ).toBeVisible()
  const caseId = new URL(page.url()).pathname.split('/').pop()
  const created = await (await page.request.get(`/api/cases/${caseId}`)).json()
  expect(created.kind).toBe('Solicitud')
  expect(created.channel).toBeNull()
  expect(created.related_case_id).toBeNull()
  expect(created.mode).toBe('Atención')
  expect(created.production).toBeNull()
  expect(created.ledger).toEqual([])
  await page.getByLabel('Búsqueda global').fill('50498765432')
  await page.getByLabel('Búsqueda global').press('Enter')
  await expect(page.locator(`a[href^="/cases/${caseId}?"]`)).toBeVisible()
})

test('autocompletado conserva relaciones y los datos al crear cliente en línea', async ({
  page,
}) => {
  const name = 'E2E Autocomplete ' + Date.now()
  const created = await page.request.post('/api/clients', {
    headers,
    data: {
      name,
      company: 'Impresos Norte',
      phones: ['+504 2222-1010'],
      emails: ['contacto@example.test'],
    },
  })
  expect(created.ok()).toBeTruthy()
  const client = await created.json()
  const contactResponse = await page.request.post(`/api/clients/${client.id}/contacts`, {
    headers,
    data: { name: 'Contacto principal', phone: '9999' },
  })
  expect(contactResponse.ok()).toBeTruthy()
  await page.getByRole('button', { name: 'Nueva solicitud', exact: true }).click()
  let d = page.getByRole('dialog'),
    customer = d.getByLabel('Cliente')
  await customer.fill('Autocomplete ' + Date.now())
  await customer.fill(name.slice(0, 18))
  const option = d.getByRole('option').filter({ hasText: name }).first()
  await expect(option).toBeVisible()
  await option.click()
  await expect(d.getByLabel('Cliente')).toHaveValue(name)
  const contact = d.getByLabel('Contacto (opcional)')
  await contact.fill('Contacto pri')
  await expect(d.getByRole('option').filter({ hasText: 'Contacto principal' })).toBeVisible()
  await d.getByRole('option').filter({ hasText: 'Contacto principal' }).click()
  await d.getByLabel('Asunto').fill('Caso con cliente y contacto seleccionados')
  await d.getByLabel('Tipo de atención').selectOption('Cotización')
  await d.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Caso con cliente y contacto seleccionados' }),
  ).toBeVisible()
  let saved = await page.request.get('/api/cases/' + new URL(page.url()).pathname.split('/').pop())
  expect(saved.ok()).toBeTruthy()
  let savedCase = await saved.json()
  expect(savedCase.client.id).toBe(client.id)
  expect(savedCase.contact_id).toBe((await contactResponse.json()).id)

  const alternateResponse = await page.request.post('/api/clients', {
    headers,
    data: { name: 'E2E Cliente alterno ' + Date.now() },
  })
  expect(alternateResponse.ok()).toBeTruthy()
  const alternate = await alternateResponse.json()
  await page.goto('/')
  await page.getByRole('button', { name: 'Nueva solicitud', exact: true }).click()
  d = page.getByRole('dialog')
  await d.getByLabel('Cliente').fill(name)
  await expect(d.getByRole('option').filter({ hasText: name })).toBeVisible()
  await d.getByRole('option').filter({ hasText: name }).click()
  await d.getByLabel('Contacto (opcional)').fill('Contacto principal')
  await d.getByRole('option').filter({ hasText: 'Contacto principal' }).click()
  await d.getByLabel('Cliente').fill(alternate.name)
  await expect(d.getByRole('option').filter({ hasText: alternate.name })).toBeVisible()
  await d.getByRole('option').filter({ hasText: alternate.name }).click()
  await expect(d.getByLabel('Contacto (opcional)')).toHaveValue('')
  await d.getByLabel('Asunto').fill('El ID anterior no se conserva')
  await d.getByLabel('Tipo de atención').selectOption('Reclamo')
  await d.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'El ID anterior no se conserva' })).toBeVisible()
  const secondCasePath = new URL(page.url()).pathname
  saved = await page.request.get('/api' + secondCasePath)
  expect(
    saved.ok(),
    `GET /api${secondCasePath}: ${saved.status()} ${await saved.text()}`,
  ).toBeTruthy()
  savedCase = await saved.json()
  expect(savedCase.client.id).toBe(alternate.id)
  expect(savedCase.contact_id ?? null).toBeNull()

  await page.goto('/')
  await page.getByRole('button', { name: 'Nueva solicitud', exact: true }).click()
  d = page.getByRole('dialog')
  const provisional = 'Provisional en flujo ' + Date.now()
  await d.getByLabel('Asunto').fill('No perder este asunto')
  await d.getByLabel('Tipo de atención').selectOption('Solicitud')
  await d.getByLabel('Descripción').fill('Tampoco perder esta descripción')
  await d.getByLabel('Cliente').fill(provisional)
  await d.getByRole('button', { name: /Crear cliente/ }).click()
  await d.getByLabel('Nombre', { exact: true }).fill(provisional)
  await d.getByRole('button', { name: 'Crear y seleccionar cliente' }).click()
  await expect(d.getByLabel('Asunto')).toHaveValue('No perder este asunto')
  await expect(d.getByLabel('Descripción')).toHaveValue('Tampoco perder esta descripción')
  await d.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'No perder este asunto' })).toBeVisible()
})

test('cotización aceptada, producción activa, bloqueo, entrega completa y cobranza separada', async ({
  page,
}) => {
  test.setTimeout(90000)
  const record = await createCase(page, 'E2E Ciclo de taller y cobranza')
  await page.getByRole('button', { name: 'Cotizaciones', exact: true }).click()
  await page.getByRole('button', { name: 'Nueva versión' }).click()
  let dialog = page.getByRole('dialog')
  await dialog.getByLabel('Cantidad').fill('100')
  await dialog.getByLabel('Precio unitario (HNL)').fill('10')
  await dialog.getByLabel('Ancho').fill('9')
  await dialog.getByLabel('Alto').fill('5')
  await dialog.getByLabel('Material / papel').fill('Couché 300 g')
  await dialog.getByLabel('Caras').selectOption('2')
  await dialog.getByLabel('Tintas').fill('CMYK')
  await dialog.getByLabel('Vigente hasta').fill('2099-01-01')
  await dialog.getByRole('button', { name: 'Guardar cotización' }).click()
  await expect(page.getByRole('heading', { name: /Versión 1/ })).toBeVisible()
  await page.getByRole('button', { name: 'Registrar decisión' }).click()
  dialog = page.getByRole('dialog')
  await dialog
    .getByLabel('Evidencia / comunicación del cliente')
    .fill('Aprobada presencialmente; evidencia verificada.')
  await dialog.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('button', { name: 'Generar orden con esta versión' })).toBeVisible()
  await page.getByRole('button', { name: 'Generar orden con esta versión' }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Fecha comprometida').fill('2099-01-01')
  await dialog.getByLabel('Vencimiento del saldo').fill('2026-01-01')
  await expect(dialog.getByLabel('Condición de pago').locator('option')).toHaveText([
    'Contado',
    'Crédito',
  ])
  await dialog.getByLabel('Condición de pago').selectOption('Crédito')
  await expect(dialog.getByLabel('Moneda')).toHaveCount(0)
  await dialog.getByLabel('Anticipo requerido (HNL)').fill('100')
  await dialog.getByLabel('Modalidad de entrega').fill('Retiro en taller')
  await dialog.getByRole('button', { name: /Generar orden de producción/ }).click()
  await expect(dialog.getByText('Orden creada en Aprobación.')).toBeVisible()
  await dialog.getByRole('button', { name: 'Mantener en Aprobación' }).click()
  await expect(page).toHaveURL(new RegExp('/cases/' + record.id + '\\?(?=.*production_id=\\d+)(?=.*tab=production)'))
  await page.reload()
  await page.getByRole('button', { name: 'Actividad', exact: true }).click()
  const orderLink = page.getByRole('link', { name: /Orden OP-/ })
  await expect(orderLink).toBeVisible()
  await orderLink.click()
  await expect(page.getByRole('heading', { name: 'Especificaciones de producción' })).toBeVisible()
  await page.getByRole('button', { name: 'Actividad', exact: true }).click()
  const quoteLink = page.getByRole('link', { name: /COT-.*versi/ })
  await expect(quoteLink).toBeVisible()
  await quoteLink.click()
  const converted = await (await page.request.get(`/api/cases/${record.id}`)).json()
  await expect(page.locator(`#quote-${converted.quotes[0].id}`)).toBeVisible()
  await page.getByRole('button', { name: 'Entregas y cobros' }).click()
  await page.getByRole('button', { name: 'Registrar abono' }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Tipo', { exact: true }).selectOption('Anticipo')
  await dialog.getByLabel('Importe (HNL)').fill('100')
  await dialog.getByLabel('Referencia / comprobante').fill('Recibo E2E 0001')
  await dialog.getByRole('button', { name: 'Guardar' }).click()
  await page.getByRole('button', { name: 'Programar', exact: true }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel(/Inicio programado/).fill('2026-10-16T10:00')
  await dialog.getByLabel('Fecha comprometida de entrega').fill('2099-01-01')
  await dialog.getByRole('button', { name: 'Guardar' }).click()
  await page.getByRole('button', { name: 'Archivos' }).click()
  await page.getByRole('button', { name: 'Adjuntar archivo' }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Archivo').setInputFiles({
    name: 'arte-e2e.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n%%EOF'),
  })
  await dialog.getByLabel('Versión del arte').fill('v1')
  await dialog.getByRole('button', { name: 'Guardar' }).click()
  await page.getByRole('button', { name: 'Producción' }).click()
  for (const stage of ['Impresión']) {
    await page.getByRole('button', { name: `Avanzar a ${stage}` }).click()
    dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: `Avanzar a ${stage}` }).click()
  }
  await page.getByRole('button', { name: 'Registrar reclamo', exact: true }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Regresar a').selectOption('APPROVAL')
  await dialog.getByLabel('Motivo del reclamo').fill('Ajuste interno de color, sin nuevo cargo.')
  await dialog.getByRole('button', { name: 'Registrar reclamo', exact: true }).click()
  await page.getByRole('button', { name: 'Avanzar a Impresión' }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Avanzar a Impresión' }).click()
  await page.getByRole('button', { name: 'Avanzar a Encuadernación' }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Avanzar a Encuadernación' }).click()
  await expect(page.locator('.production-path').getByRole('button', { name: 'Confirmar trabajo terminado' })).toBeVisible()
  const currentForScan = await (await page.request.get(`/api/cases/${record.id}`)).json()
  const scanResponse = await scanAsOperator(page, `CGOP1:${currentForScan.production.scan_id}`)
  expect(scanResponse.ok).toBeTruthy()
  expect(scanResponse.data.result).toBe('released')
  await page.reload()
  await page.getByRole('button', { name: 'Bloquear' }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Motivo').fill('Inspección preventiva del pedido.')
  await dialog.getByRole('button', { name: 'Guardar' }).click()
  await page.getByRole('button', { name: 'Resolver bloqueo' }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Motivo').fill('Inspección completada; material conforme.')
  await dialog.getByRole('button', { name: 'Guardar' }).click()
  await page.getByRole('button', { name: 'Entregas y cobros' }).click()
  await page.getByRole('button', { name: 'Registrar entrega de OP completa' }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Modalidad').selectOption('Retiro en local')
  await dialog.getByLabel('Recibido por (opcional)').fill('DEMO · María')
  await dialog.getByLabel('Evidencia / referencia (opcional)').fill('Comprobante E2E entrega completa.')
  await dialog.getByLabel('Motivo del saldo pendiente').fill('Crédito vencido; retiro autorizado por coordinación.')
  await dialog.getByRole('button', { name: 'Registrar entrega con saldo pendiente' }).click()
  await expect(page.getByText('Comprobante E2E entrega completa.')).toBeVisible()
  await page.getByRole('button', { name: 'Cerrar atención' }).click()
  await expect(page.getByRole('button', { name: 'Abrir atención' })).toBeVisible()
  await expect(page.getByText('Comprobante E2E entrega completa.', { exact: true })).toBeVisible()
  const full = await page.request.get(`/api/cases/${record.id}`)
  expect(full.ok()).toBeTruthy()
  const current = await full.json()
  expect(current.mode).toBe('Producción')
  expect(current.production.stage).toBe('READY')
  expect(current.delivery_status).toBe('Completa')
  expect(current.balance).toBe('900.00')
  expect(current.status).toBe('Cerrado')
  expect(current.ledger.filter((entry) => entry.kind === 'Anticipo')).toHaveLength(1)
  expect(current.ledger.filter((entry) => entry.kind === 'Abono')).toHaveLength(0)
  expect(current.production.authorized_at).toBeNull()
  expect(current.production.specs_snapshot.items[0].specs.material).toBe('Couché 300 g')

  const settled = await page.request.get(`/api/cases/${record.id}`)
  expect(settled.ok()).toBeTruthy()
  const finalRecord = await settled.json()
  expect(finalRecord.delivery_status).toBe('Completa')
  expect(finalRecord.production.stage).toBe('READY')
  expect(finalRecord.production.active_elapsed_seconds).toBeNull()
  expect(finalRecord.balance).toBe('900.00')
  expect(finalRecord.payment_status).not.toBe('Pagado')
  expect(finalRecord.ledger.filter((entry) => entry.kind === 'Abono')).toHaveLength(0)
})

test('note template appends to an existing internal draft', async ({ page }) => {
  await createCase(page, 'E2E note template')
  const editor = page.getByLabel('Nota interna', { exact: true })
  await editor.fill('Existing internal note.')
  await page.getByRole('button', { name: 'Usar plantilla' }).click()
  await page.getByLabel('Plantilla').selectOption('Seguimiento de recogida')
  await page.getByLabel('Medio de contacto').fill('WhatsApp manual')
  await page.getByLabel('Respuesta').fill('Customer will pick up Friday')
  await page.getByRole('button', { name: /la nota/ }).click()
  await expect(editor).toHaveValue(
    /Existing internal note\.[\s\S]*Medio de contacto: WhatsApp manual[\s\S]*Customer will pick up Friday/,
  )
})
