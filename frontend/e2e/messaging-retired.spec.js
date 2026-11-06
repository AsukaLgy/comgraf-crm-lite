import { test, expect } from '@playwright/test'

test('la mensajería retirada no aparece ni consulta endpoints en navegación y configuración', async ({
  page,
}) => {
  const requests = []
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    requests.push(path)
    const responses = {
      '/api/auth/me': {
        id: 1,
        name: 'Admin',
        roles: ['Administrador'],
        permissions: ['*'],
        timezone: 'America/Tegucigalpa',
      },
      '/api/version': { product_version: '1.4.0', build: 'test', contract_version: '5' },
      '/api/users': [],
      '/api/roles': { roles: [], available: [] },
    }
    await route.fulfill({
      status: path in responses ? 200 : 500,
      contentType: 'application/json',
      body: JSON.stringify(responses[path] ?? { detail: 'Unexpected API call' }),
    })
  })
  await page.goto('/mail')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('link', { name: /Correos por clasificar/ })).toHaveCount(0)
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Configuración' })).toBeVisible()
  await expect(page.getByText('Correo de la empresa')).toHaveCount(0)
  await expect(page.getByText('WhatsApp')).toHaveCount(0)
  await page.waitForTimeout(16000)
  expect(requests.filter((path) => path.includes('/mail') || path.includes('/email'))).toEqual([])
  expect(errors).toEqual([])
})

test('notas e historial vinculado son de solo lectura y conservan borradores antiguos', async ({
  page,
}) => {
  const errors = []
  const requests = []
  let savedNote
  const record = {
    id: 1,
    number: 'CG-000001',
    subject: 'Solicitud de prueba',
    kind: 'Consulta',
    channel: 'Correo',
    created_at: '2026-10-20T12:00:00Z',
    owner_id: 1,
    lifecycle: 'Activo',
    status: 'Abierto',
    priority: 'Normal',
    mode: 'Atención',
    version: 1,
    production_count: 0,
    production_pending_count: 0,
    production: null,
    productions: [],
    attachments: [],
    tasks: [],
    quotes: [],
    completion_blockers: [],
    client: {
      id: 1,
      name: 'Cliente de prueba',
      phones: [],
      emails: ['cliente@example.com'],
      addresses: [],
    },
    drafts: [{ channel: 'Correo', body: 'Borrador anterior', version: 1 }],
    email_messages: [
      {
        id: 7,
        direction: 'Saliente',
        status: 'Pendiente',
        sender: 'empresa@example.test',
        subject: 'Mensaje histórico',
        body_text: 'Contenido histórico pendiente',
        created_at: '2026-10-20T12:00:00Z',
        attachments: [{ id: 9, filename: 'historico.pdf' }],
      },
    ],
    events: [
      {
        id: 8,
        kind: 'Correo entrante',
        channel: 'Correo',
        body: 'Mensaje histórico conservado',
        actor_id: 1,
        created_at: '2026-10-20T12:00:00Z',
        data: { email_message_id: 7 },
      },
    ],
  }
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    requests.push(path)
    const data =
      path === '/api/auth/me'
        ? {
            id: 1,
            name: 'Admin',
            roles: ['Administrador'],
            permissions: ['*'],
            timezone: 'America/Tegucigalpa',
          }
        : path === '/api/version'
          ? { product_version: '1.4.0', build: 'test', contract_version: '5' }
          : path === '/api/cases/1'
            ? record
            : path === '/api/users'
              ? []
              : path === '/api/counts'
                ? {}
                : path === '/api/cases/1/drafts/Nota'
                  ? { version: 1 }
                  : path === '/api/cases/1/events'
                    ? ((savedNote = route.request().postDataJSON()), record)
                    : null
    await route.fulfill({
      status: data === null ? 500 : 200,
      contentType: 'application/json',
      body: JSON.stringify(data ?? { detail: 'Unexpected API call' }),
    })
  })
  await page.goto('/mail')
  await page.evaluate(() =>
    localStorage.setItem('comgraf.draft.1.1.Correo', 'Borrador local importante'),
  )
  await page.goto('/cases/1')
  await expect(page.getByText('Mensaje histórico conservado')).toBeVisible()
  await expect(page.getByText('Contenido histórico pendiente')).toBeVisible()
  await expect(page.getByText('Estado histórico: Pendiente')).toBeVisible()
  await expect(page.getByRole('link', { name: 'historico.pdf' })).toHaveAttribute(
    'href',
    '/api/mail/attachments/9',
  )
  await expect(page.getByRole('button', { name: 'Usar plantilla' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Correo' })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'WhatsApp' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Enviar correo|Reintentar/ })).toHaveCount(0)
  await page.getByRole('textbox', { name: 'Nota interna' }).fill('Nota de operación diaria')
  await page.getByRole('button', { name: 'Guardar nota' }).click()
  await expect.poll(() => savedNote?.body).toBe('Nota de operación diaria')
  expect(savedNote.channel).toBe('Nota')
  expect(await page.evaluate(() => localStorage.getItem('comgraf.draft.1.1.Correo'))).toBe(
    'Borrador local importante',
  )
  expect(requests.filter((path) => path.includes('/mail') || path.includes('/email'))).toEqual([])
  expect(errors).toEqual([])
})
