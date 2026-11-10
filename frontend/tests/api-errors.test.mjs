import test from 'node:test'
import assert from 'node:assert/strict'
import { api } from '../src/api.js'

async function withResponse(response, check) {
  const prior = globalThis.fetch
  globalThis.fetch = async () => response
  try {
    await check()
  } finally {
    globalThis.fetch = prior
  }
}

test('validation names the field in Spanish without exposing the raw response', async () => {
  const response = new Response(
    JSON.stringify({
      detail: [
        {
          type: 'greater_than',
          loc: ['body', 'items', 0, 'quantity'],
          msg: 'Input should be greater than 0',
        },
      ],
    }),
    { status: 422, headers: { 'Content-Type': 'application/json' } },
  )
  await withResponse(response, async () => {
    await assert.rejects(
      api('/probe'),
      (error) =>
        error.status === 422 && error.message === 'Producto 1 · Cantidad: debe ser mayor que cero',
    )
  })
})

test('permission, conflict and expired session have distinct guidance', async () => {
  for (const [status, expected] of [
    [401, /sesión venció/i],
    [403, /autorización/i],
    [409, /registro cambió/i],
  ]) {
    await withResponse(
      new Response('<html>private</html>', { status, headers: { 'Content-Type': 'text/html' } }),
      async () => {
        await assert.rejects(
          api('/probe'),
          (error) => expected.test(error.message) && !error.message.includes('<html>'),
        )
      },
    )
  }
})

test('internal error reports its incident, and successful non-JSON response remains uncertain', async () => {
  await withResponse(
    new Response('<html>internal SQL</html>', {
      status: 500,
      headers: {
        'Content-Type': 'text/html',
        'X-Comgraf-Incident': 'abc123',
      },
    }),
    async () => {
      await assert.rejects(
        api('/probe'),
        (error) =>
          error.code === 'INTERNAL_ERROR' &&
          error.message.includes('abc123') &&
          !error.message.includes('SQL'),
      )
    },
  )
  await withResponse(
    new Response('<html>proxy</html>', { status: 201, headers: { 'Content-Type': 'text/html' } }),
    async () => {
      await assert.rejects(
        api('/probe'),
        (error) =>
          error.code === 'UNCERTAIN_RESULT' && /comprueba el resultado/i.test(error.message),
      )
    },
  )
})

test('connection failure retains a recoverable message', async () => {
  const prior = globalThis.fetch
  globalThis.fetch = async () => {
    throw new TypeError('Network failed')
  }
  try {
    await assert.rejects(
      api('/probe'),
      (error) => error.code === 'CONNECTION_ERROR' && /datos permanecen/i.test(error.message),
    )
  } finally {
    globalThis.fetch = prior
  }
})

test('outdated local catalog is detected before submitting a Talonario CAI', async () => {
  const prior = globalThis.fetch
  const calls = []
  globalThis.fetch = async (path) => {
    calls.push(path)
    return new Response(JSON.stringify({ contract_version: '5' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  try {
    await assert.rejects(
      api('/production-requests', {
        method: 'POST',
        body: {
          items: [{ product: 'Talonario CAI' }],
        },
      }),
      (error) =>
        error.code === 'CLIENT_CONTRACT_MISMATCH' &&
        /Reinicia el proceso local/i.test(error.message),
    )
    assert.deepEqual(calls, ['/api/version'])
  } finally {
    globalThis.fetch = prior
  }
})
