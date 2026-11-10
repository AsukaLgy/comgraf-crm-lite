/* global URL, console */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const out = '../.runtime/v150-proof'
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ headless: true })
const production = {
  id: 7,
  order_number: 'OP-00007',
  stage: 'APPROVAL',
  stage_label: 'Aprobación',
  delivery_status: 'Pendiente',
  workflow_cycle: 1,
  classification_required: false,
  binding_confirmed_at: null,
  cancelled_at: null,
  blocked_since: null,
  active_elapsed_seconds: 0,
  currency: 'HNL',
  specs_snapshot: { items: [] },
}
const record = {
  id: 1,
  number: 'CG-000001',
  subject: 'Solicitud de prueba',
  description: '',
  kind: 'Solicitud',
  mode: 'Producción',
  status: 'Abierto',
  lifecycle: 'Activo',
  priority: 'Normal',
  version: 1,
  created_at: '2026-11-08T18:30:00Z',
  owner_id: 1,
  next_action: '',
  client: {
    id: 1,
    name: 'Cliente Ficticio',
    company: '',
    rtn: '',
    phones: [],
    emails: [],
    addresses: [],
  },
  production_count: 1,
  production,
  productions: [production],
  delivery_status: 'Pendiente',
  attachments: [],
  items: [],
  quotes: [],
  tasks: [],
  events: [],
  deliveries: [],
  ledger: [],
  completion_blockers: [],
}
for (const [name, viewport] of [
  ['desktop', { width: 1366, height: 768 }],
  ['mobile', { width: 390, height: 844 }],
]) {
  production.stage = 'APPROVAL'
  production.stage_label = 'Aprobación'
  record.subject = 'Solicitud de prueba'
  record.version = 1
  const page = await browser.newPage({ viewport })
  page.on('pageerror', (error) => {
    throw error
  })
  let stageRequests = 0,
    titleRequests = 0,
    usersRequests = 0
  await page.route('**/inbox/pool', (route) =>
    route.fulfill({ path: 'dist/index.html', contentType: 'text/html' }),
  )
  await page.route('**/cases/1?*', (route) =>
    route.fulfill({ path: 'dist/index.html', contentType: 'text/html' }),
  )
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname
    let body = []
    if (path === '/api/auth/me')
      body = {
        id: 1,
        name: 'Admin de prueba',
        roles: ['Administrador'],
        permissions: ['*'],
        timezone: 'America/Tegucigalpa',
      }
    else if (path === '/api/version')
      body = { product_version: '1.5.0', contract_version: '5', commit: 'test' }
    else if (path === '/api/counts') body = {}
    else if (path === '/api/users') {
      usersRequests++
      body = []
    } else if (path === '/api/cases') body = { items: [record], total: 1, page: 1, page_size: 25 }
    else if (path === '/api/cases/1') body = record
    else if (path === '/api/cases/1/production/admin-stage') {
      stageRequests++
      const input = route.request().postDataJSON()
      if (input.production_id !== 7 || input.stage !== 'READY')
        throw new Error('Se cambió otra OP o etapa')
      production.stage = 'READY'
      production.stage_label = 'Listo para entregar'
      record.version++
      body = record
    } else if (path === '/api/cases/1/title') {
      titleRequests++
      const input = route.request().postDataJSON()
      if (Object.keys(input).sort().join() !== 'title,version')
        throw new Error('Edición de título envió otros campos')
      record.subject = input.title
      record.version++
      body = record
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  })
  await page.goto('http://127.0.0.1:4173/inbox/pool')
  await page.getByText('CG-000001').first().waitFor()
  if (await page.getByRole('columnheader', { name: 'Saldo' }).count())
    throw new Error('Saldo visible en Pool')
  await page.getByRole('columnheader', { name: 'Fecha de creación' }).waitFor()
  const created = await page.locator('tbody time').first().innerText()
  if (!created.includes('12:30')) throw new Error(`Hora de creación incorrecta: ${created}`)
  await page.screenshot({ path: `${out}/pool-${name}.png`, fullPage: true })
  const usersLoaded = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/users',
  )
  await page.goto(
    'http://127.0.0.1:4173/cases/1?production_id=7&tab=files&from=%2Finbox%2Fproduction',
  )
  await usersLoaded
  await page.getByLabel('Cambiar etapa de OP-00007').waitFor()
  await page.screenshot({ path: `${out}/etapas-${name}.png`, fullPage: true })
  const stageResponse = page.waitForResponse((response) =>
    response.url().includes('/production/admin-stage'),
  )
  await page.getByLabel('Cambiar etapa de OP-00007').selectOption('READY')
  await stageResponse
  if (stageRequests !== 1) throw new Error('Cambio administrativo duplicado')
  if (await page.getByRole('dialog').count()) throw new Error('Se pidió un motivo al administrador')
  await page.getByRole('button', { name: 'Editar título' }).click()
  await page.getByRole('textbox', { name: 'Título de la solicitud' }).fill('Título corregido')
  await page.getByRole('textbox', { name: 'Título de la solicitud' }).press('Enter')
  await page.getByRole('heading', { name: 'Título corregido' }).waitFor()
  if (titleRequests !== 1) throw new Error('Edición de título no guardada una vez')
  if (usersRequests !== 1) throw new Error('Se recargó la lista de usuarios sin necesidad')
  await page.screenshot({ path: `${out}/titulo-${name}.png`, fullPage: true })
  console.log(name, 'Pool sin saldo, hora local, etapa administrativa y título verificados')
  await page.close()
}
await browser.close()
