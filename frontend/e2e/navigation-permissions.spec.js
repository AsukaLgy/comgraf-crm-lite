import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { PERMISSION_CATALOG } from '../src/permissionCatalog.js'

const credentials = JSON.parse(fs.readFileSync(path.resolve('../.runtime/e2e.json'), 'utf8'))
const headers = { 'X-Comgraf-Request': '1', 'X-Comgraf-Contract': '4', 'X-Comgraf-Build': '1.4.0' }

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Usuario', { exact: true }).fill(credentials.username)
  await page.getByLabel('Contraseña', { exact: true }).fill(credentials.password)
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Mi día', exact: true })).toBeVisible()
  await expect(page.locator('.sidebar .workspace')).toHaveCount(0)
  await expect(page.locator('.sidebar .nav-label')).toHaveText('OPERACIONES')
  await expect(page.locator('.sidebar').getByRole('img', { name: 'Emblema de Comgraf' })).toBeVisible()
})

test('Mi día muestra trabajo pendiente y Pool general conserva solicitudes sin asignar', async ({ page }) => {
  const clientResponse = await page.request.post('/api/clients', { headers, data: { name: 'E2E · Pool ' + Date.now() } })
  expect(clientResponse.ok()).toBeTruthy()
  const client = await clientResponse.json()
  const subject = 'E2E · Sin asignar ' + Date.now()
  const caseResponse = await page.request.post('/api/cases', { headers, data: { client_id: client.id, subject, kind: 'Cotización' } })
  expect(caseResponse.ok()).toBeTruthy()

  const actionResponse = page.waitForResponse((response) => response.url().includes('/api/cases?') && new URL(response.url()).searchParams.get('view') === 'action')
  await page.reload()
  expect((await actionResponse).ok()).toBeTruthy()
  await expect(page.locator('.home-metrics .metric')).toHaveCount(3)
  await expect(page.locator('.home-metrics')).not.toContainText('Solicitudes sin asignar')
  await expect(page.locator('.inbox .tabs')).not.toContainText('Solicitudes sin asignar')
  await expect(page.locator('.inbox .tabs .active')).toContainText('Requieren acción')
  await expect(page.locator('.inbox .table-wrap')).toBeVisible()

  const savedViews = []
  await page.route('**/api/views', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    savedViews.push(route.request().postDataJSON())
    return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' })
  })
  await page.getByRole('button', { name: 'Guardar vista' }).click()
  await page.getByRole('dialog').getByLabel('Nombre de la vista').fill('E2E · Trabajo pendiente')
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(savedViews[0].filters.view).toBe('action')

  await page.getByRole('link', { name: 'Pool general' }).click()
  await expect(page).toHaveURL(/\/inbox\/pool$/)
  await expect(page.locator('.inbox .tabs .active')).toContainText('Solicitudes sin asignar')
  await expect(page.getByRole('row').filter({ hasText: subject })).toBeVisible()
  await expect(page.locator('.inbox .tabs .active .badge')).not.toHaveText('0')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('link', { name: 'Mi día' }).click()
  await expect(page.locator('.home-metrics .metric')).toHaveCount(3)
  await expect(page.locator('.inbox .tabs')).not.toContainText('Solicitudes sin asignar')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
})

test('las etiquetas de permisos son legibles y el formulario envía solo identificadores internos', async ({ page }) => {
  await page.goto('/settings')
  const roles = await (await page.request.get('/api/roles')).json()
  expect(roles.available.every((permission) => PERMISSION_CATALOG[permission])).toBeTruthy()
  const original = roles.roles.find((role) => role.name === 'Producción').permissions
  const coordinator = page.locator('.role-row').filter({ hasText: 'Coordinador' })
  await expect(coordinator).toContainText('Consultar todas las solicitudes')
  await expect(coordinator).toContainText('Permiso reservado de reapertura')
  await expect(coordinator).toContainText('Gestionar cobros y devoluciones')
  await expect(coordinator).toContainText('Registrar ajustes financieros')
  await expect(page.locator('.role-row').filter({ hasText: 'Administrador' })).toContainText('Acceso completo')
  const scanner = page.locator('.role-row').filter({ hasText: 'Escáner de encuadernación' })
  await expect(scanner).toContainText('Confirmar trabajos terminados por QR')
  await expect(scanner.getByRole('button', { name: 'Configurar' })).toHaveCount(0)

  const writes = []
  await page.route('**/api/roles/**', async (route) => {
    if (route.request().method() !== 'PUT') return route.continue()
    writes.push(route.request().postDataJSON())
    return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' })
  })
  const production = page.locator('.role-row').filter({ has: page.locator('strong').filter({ hasText: /^Producción$/ }) })
  await production.getByRole('button', { name: 'Configurar' }).click()
  let dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('checkbox', { name: /Gestionar producción y entregas/ })).toBeChecked()
  await expect(dialog).toContainText('ninguna operación actual del CRM lo consulta')
  await dialog.getByRole('button', { name: 'Guardar' }).click()
  await expect(dialog).toHaveCount(0)
  expect(writes).toHaveLength(0)
  expect((await (await page.request.get('/api/roles')).json()).roles.find((role) => role.name === 'Producción').permissions).toEqual(original)

  await production.getByRole('button', { name: 'Configurar' }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByRole('checkbox', { name: /Consultar indicadores/ }).check()
  await dialog.getByRole('button', { name: 'Guardar' }).click()
  await expect(dialog).toHaveCount(0)
  expect(writes).toHaveLength(1)
  expect(new Set(writes[0].permissions)).toEqual(new Set([...original, 'reports']))
  expect(writes[0].permissions.every((permission) => roles.available.includes(permission))).toBeTruthy()

  await page.setViewportSize({ width: 390, height: 844 })
  await production.getByRole('button', { name: 'Configurar' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
})
