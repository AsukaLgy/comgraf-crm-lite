import { HNL_CURRENCY, PRODUCT } from './domain.js'

export const API_CONTRACT_VERSION = '5'
export const PRODUCT_VERSION = '1.5.0'
let contractCheck

const FIELD_NAMES = {
  client_id: 'Cliente',
  subject: 'Asunto',
  product: 'Producto',
  quantity: 'Cantidad',
  unit_price: 'Precio',
  games_per_pad: 'Juegos por talonario',
  cai_format: 'Formato',
  paper_type: 'Tipo de papel',
  additional_copies: 'Número de copias',
  cai_binding: 'Encuadernación',
  payment_terms: 'Condición de pago',
  delivery_method: 'Modalidad de entrega',
  requested_date: 'Fecha solicitada',
  committed_date: 'Fecha comprometida',
  payment_due_date: 'Vencimiento del saldo',
}
const makeError = (message, code, status, incidentId) =>
  Object.assign(new Error(message), { code, status, incidentId })
const responseData = async (response) => {
  if (!response.headers.get('content-type')?.toLowerCase().includes('json')) return null
  try {
    return await response.json()
  } catch {
    return null
  }
}
const validationMessage = (issue) => {
  const location = Array.isArray(issue.loc) ? issue.loc.filter((part) => part !== 'body') : []
  const index = location.indexOf('items')
  const prefix =
    index >= 0 && Number.isInteger(location[index + 1])
      ? `Producto ${location[index + 1] + 1} · `
      : ''
  const key = [...location]
    .reverse()
    .find((part) => typeof part === 'string' && part !== 'items' && part !== 'specs')
  const field = FIELD_NAMES[key] || (index >= 0 ? 'Producto' : 'Campo')
  const type = issue.type || ''
  let problem = 'tiene un valor inválido'
  if (type === 'missing') problem = 'es obligatorio'
  else if (type === 'literal_error') problem = 'debe ser una opción permitida'
  else if (type.includes('int_')) problem = 'debe ser un entero válido'
  else if (type.includes('date_')) problem = 'debe ser una fecha válida'
  else if (type === 'greater_than') problem = 'debe ser mayor que cero'
  else if (type === 'greater_than_equal') problem = 'debe ser cero o mayor'
  else if (type === 'less_than_equal') problem = 'supera el máximo permitido'
  else if (type === 'decimal_max_places') problem = 'tiene demasiados decimales'
  else if (type === 'extra_forbidden') problem = 'no está permitido'
  else if (type === 'value_error' && typeof issue.msg === 'string')
    problem = issue.msg.replace(/^Value error,\s*/i, '')
  return `${prefix}${field}: ${problem}`
}
function responseError(response, data) {
  const detail = typeof data?.detail === 'string' ? data.detail : null
  const incidentId = data?.incident_id || response.headers.get('X-Comgraf-Incident') || null
  const status = response.status
  if (status === 401)
    return makeError(
      'La sesión venció. Inicia sesión nuevamente.',
      'SESSION_EXPIRED',
      status,
      incidentId,
    )
  if (status === 403)
    return makeError(
      detail || 'No tienes autorización para esta operación.',
      'PERMISSION_DENIED',
      status,
      incidentId,
    )
  if (status === 422) {
    const issues = Array.isArray(data?.detail)
      ? data.detail.map(validationMessage).join(' · ')
      : null
    return makeError(
      issues || detail || 'Revisa los campos del formulario.',
      'FIELD_VALIDATION',
      status,
      incidentId,
    )
  }
  if (status === 409)
    return makeError(
      detail || 'El registro cambió. Actualiza y revisa antes de reintentar.',
      data?.code || 'VERSION_CONFLICT',
      status,
      incidentId,
    )
  if (status >= 500)
    return makeError(
      `Ocurrió un error del servidor${incidentId ? ` (incidencia ${incidentId})` : ''}. Conserva el formulario y reintenta.`,
      data?.code || 'INTERNAL_ERROR',
      status,
      incidentId,
    )
  return makeError(
    detail || `No se pudo completar la operación (HTTP ${status}).`,
    data?.code || 'HTTP_ERROR',
    status,
    incidentId,
  )
}

async function assertContract() {
  if (!contractCheck) {
    contractCheck = fetch('/api/version', { credentials: 'same-origin', cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) {
          const error = new Error(
            'No se pudo comprobar la versión del servidor. Actualiza y reinicia Comgraf.',
          )
          error.code = 'CLIENT_CONTRACT_MISMATCH'
          throw error
        }
        const version = await responseData(response)
        if (!version)
          throw makeError(
            'No se pudo comprobar la versión del servidor. Reintenta cuando esté disponible.',
            'CLIENT_CONTRACT_MISMATCH',
            response.status,
          )
        return version
      })
      .catch((error) => {
        contractCheck = null
        if (error?.code) throw error
        throw makeError(
          'No se pudo conectar con el servidor. Tus datos permanecen en el formulario.',
          'CONNECTION_ERROR',
        )
      })
  }
  const version = await contractCheck
  if (String(version.contract_version) !== API_CONTRACT_VERSION) {
    const error = new Error(
      `La interfaz ${PRODUCT_VERSION} usa el contrato ${API_CONTRACT_VERSION}, pero el servidor ofrece el contrato ${version.contract_version}. Ejecuta scripts/update-local.ps1 y reinicia Comgraf.`,
    )
    error.code = 'CLIENT_CONTRACT_MISMATCH'
    throw error
  }
  return version
}

export async function api(path, options = {}) {
  const { body, ...rest } = options
  if ((rest.method || 'GET').toUpperCase() !== 'GET') {
    const version = await assertContract()
    if (
      body?.items?.some((item) => item.product === PRODUCT.CAI) &&
      version.catalog_revision !== 2
    ) {
      throw makeError(
        'El servidor local todavía usa un catálogo anterior. Reinicia el proceso local antes de crear Talonario CAI.',
        'CLIENT_CONTRACT_MISMATCH',
      )
    }
  }
  let response
  try {
    response = await fetch('/api' + path, {
      credentials: 'same-origin',
      ...rest,
      headers: {
        'X-Comgraf-Request': '1',
        'X-Comgraf-Contract': API_CONTRACT_VERSION,
        'X-Comgraf-Build': PRODUCT_VERSION,
        ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...rest.headers,
      },
      body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw makeError(
      'No se pudo conectar o confirmar la respuesta. Tus datos permanecen en el formulario; reintenta con la misma operación.',
      'CONNECTION_ERROR',
    )
  }
  const data = await responseData(response)
  if (!response.ok) throw responseError(response, data)
  if (response.status !== 204 && data === null)
    throw makeError(
      body?.key
        ? 'El servidor aceptó la operación, pero no se pudo confirmar su respuesta. Reintenta con los mismos datos; no se creará un duplicado.'
        : 'El servidor aceptó la operación, pero no se pudo confirmar su respuesta. Conserva el formulario y comprueba el resultado antes de repetir.',
      'UNCERTAIN_RESULT',
      response.status,
    )
  return data
}
export const can = (user, permission) =>
  user?.permissions?.some((p) => p === '*' || p === permission)
export const money = (v, currency = HNL_CURRENCY) =>
  new Intl.NumberFormat('es-HN', { style: 'currency', currency }).format(Number(v || 0))
export const quantity = (v) =>
  new Intl.NumberFormat('es-HN', { maximumFractionDigits: 3 }).format(Number(v || 0))
export let timezone = 'America/Tegucigalpa'
export const setTimezone = (value) => {
  timezone = value
}
const dateParts = (value) => new Date(`${value}T12:00:00-06:00`)
export const formatDate = (value) =>
  value
    ? new Intl.DateTimeFormat('es-HN', {
        timeZone: timezone,
        year: 'numeric',
        month: 'short',
        day: '2-digit',
      }).format(value.length === 10 ? dateParts(value) : new Date(value))
    : 'Sin fecha'
export const formatDateTime = (value) =>
  value
    ? value.length === 10
      ? formatDate(value)
      : new Intl.DateTimeFormat('es-HN', {
          timeZone: timezone,
          year: 'numeric',
          month: 'short',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date(value))
    : 'Sin fecha'
export const date = formatDate
export const dateHonduras = formatDateTime
export const localDate = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
export const dayKey = (value) =>
  value.length === 10
    ? value
    : new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(value))
export const localInput = (value) => {
  if (!value) return ''
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(value))
      .map((p) => [p.type, p.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}
export function toUTC(local) {
  let guess = new Date(local + ':00Z')
  const intended = guess.getTime()
  for (let n = 0; n < 2; n++) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(guess)
        .map((p) => [p.type, p.value]),
    )
    const rendered = Date.parse(
      `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`,
    )
    guess = new Date(guess.getTime() + intended - rendered)
  }
  return guess.toISOString()
}
export const uid = () =>
  globalThis.crypto?.randomUUID
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(20)), (x) =>
        x.toString(16).padStart(2, '0'),
      ).join('')
