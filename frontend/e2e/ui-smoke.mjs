/* global URL, console */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const out = '../.runtime/print-proof'
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ headless: true })
for (const [name, viewport] of [
  ['desktop', { width: 1366, height: 768 }],
  ['mobile', { width: 390, height: 844 }],
]) {
  const page = await browser.newPage({ viewport })
  page.on('pageerror', (error) => console.log('PAGE ERROR', error.message))
  await page.route('**/inbox/mine', (route) =>
    route.fulfill({ path: 'dist/index.html', contentType: 'text/html' }),
  )
  await page.route('**/cases/1?*', (route) =>
    route.fulfill({ path: 'dist/index.html', contentType: 'text/html' }),
  )
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname
    const body =
      path === '/api/auth/me'
        ? {
            id: 1,
            name: 'Admin de prueba',
            roles: ['Administrador'],
            permissions: ['*'],
            timezone: 'America/Tegucigalpa',
          }
        : path === '/api/version'
          ? { contract_version: '5', build: 'test' }
          : path === '/api/counts'
            ? {}
            : path === '/api/cases'
              ? { items: [], total: 0, page: 1, page_size: 25 }
              : path === '/api/cases/1'
                ? {
                    id: 1,
                    number: 'CG-000001',
                    subject: 'Solicitud de prueba',
                    description: '',
                    kind: 'Solicitud',
                    status: 'Abierto',
                    lifecycle: 'Activo',
                    priority: 'Normal',
                    version: 1,
                    client: {
                      id: 1,
                      name: 'Cliente Ficticio',
                      company: '',
                      rtn: '',
                      phones: [],
                      emails: [],
                      addresses: [],
                    },
                    production: null,
                    productions: [],
                    attachments: [],
                    items: [],
                    quotes: [],
                    tasks: [],
                    events: [],
                    deliveries: [],
                    ledger: [],
                    completion_blockers: [],
                  }
                : []
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.goto('http://127.0.0.1:4173/inbox/mine')
  console.log('initial', name, (await page.locator('body').innerText()).slice(0, 500))
  await page.screenshot({ path: `${out}/ui-debug-${name}.png`, fullPage: true })
  await page.getByRole('button', { name: 'Nueva solicitud' }).click()
  await page.getByLabel('Asunto').fill('Borrador conservado')
  await page
    .getByPlaceholder('Buscar nombre, empresa, RTN, teléfono o correo')
    .fill('Cliente Ficticio')
  await page.getByText('＋ Crear cliente').click()
  await page.screenshot({ path: `${out}/alta-cliente-${name}.png`, fullPage: true })
  await page.locator('.inline-create').getByRole('button', { name: 'Cancelar' }).click()
  if ((await page.locator('.inline-create').count()) > 0)
    throw new Error('No se cerró el alta rápida')
  if ((await page.getByLabel('Asunto').inputValue()) !== 'Borrador conservado')
    throw new Error('Se perdió el borrador')
  await page.goto('http://127.0.0.1:4173/cases/1?tab=files&from=%2Finbox%2Fproduction')
  await page.screenshot({ path: `${out}/navegacion-${name}.png`, fullPage: true })
  const active = await page.locator('.sidebar nav a.active').allTextContents()
  if (active.length !== 1 || !active[0].includes('Producción'))
    throw new Error(`Navegación incorrecta: ${active}`)
  console.log(name, active)
  await page.close()
}
await browser.close()
