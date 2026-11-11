// Shared UI vocabulary. Keep these labels aligned with backend/app/schemas.py;
// the server remains authoritative for validation and state transitions.
export const PRODUCTION_STAGE = Object.freeze({
  NEW: 'NEW',
  APPROVAL: 'APPROVAL',
  PRINTING: 'PRINTING',
  WORKSHOP: 'WORKSHOP',
  READY: 'READY',
})

export const PRODUCTION_STAGES = Object.freeze(Object.values(PRODUCTION_STAGE))
export const PRODUCTION_NEXT_STAGE = Object.freeze({
  NEW: PRODUCTION_STAGE.APPROVAL,
  APPROVAL: PRODUCTION_STAGE.PRINTING,
  PRINTING: PRODUCTION_STAGE.WORKSHOP,
  WORKSHOP: PRODUCTION_STAGE.READY,
})
export const PRODUCTION_STAGE_LABELS = Object.freeze({
  NEW: 'Nuevo',
  APPROVAL: 'Aprobación',
  PRINTING: 'Impresión',
  WORKSHOP: 'Encuadernación',
  READY: 'Listo para entregar',
})

export const CASE_STATUSES = Object.freeze(['Abierto', 'Cerrado'])

export const CASE_PRIORITIES = Object.freeze(['Baja', 'Normal', 'Alta', 'Urgente'])

export const PRODUCT = Object.freeze({
  BUSINESS_CARDS: 'Tarjetas de presentación',
  FORMS: 'Talonarios y facturas',
  CAI: 'Talonario CAI',
  FLYERS: 'Volantes y flyers',
  NOTEBOOKS: 'Libretas y cuadernos',
  BANNERS: 'Banners y lonas',
  OTHER: 'Otros trabajos',
})

export const LEGACY_CAI_PRODUCT = 'Talonarios de factura CAI'
export const LEGACY_CAI_PRODUCTS = Object.freeze([
  'Recibos por honorarios (CAI)',
  'Facturas (CAI)',
  'Otros (CAI)',
  LEGACY_CAI_PRODUCT,
])
export const CAI_PRODUCTS = Object.freeze([PRODUCT.CAI, ...LEGACY_CAI_PRODUCTS])
export const FISCAL_DOCUMENT_TYPES = Object.freeze([
  'Factura',
  'Factura prevalorada',
  'Recibo por honorarios profesionales',
  'Boleta de compra',
  'Constancia de donación',
  'Nota de crédito',
  'Nota de débito',
  'Guía de remisión',
  'Comprobante de retención',
])
export const PRINT_FORM_PRODUCTS = Object.freeze([PRODUCT.FORMS, ...CAI_PRODUCTS])
export const isCaiProduct = (product) => CAI_PRODUCTS.includes(product)
export const usesPrintForm = (product) => PRINT_FORM_PRODUCTS.includes(product)
export const newOrderProduct = (product) =>
  LEGACY_CAI_PRODUCTS.includes(product) ? PRODUCT.CAI : product
export const PRODUCTS = Object.freeze(Object.values(PRODUCT))
export const PAYMENT_TERMS = Object.freeze(['Contado', 'Crédito'])
export const PAYMENT_TERM_OPTIONS = Object.freeze(
  PAYMENT_TERMS.map((value) => ({ value, label: value })),
)
export const DELIVERY_METHOD_OPTIONS = Object.freeze([
  { value: 'Retiro en local', label: 'Retiro en local' },
  { value: 'Entrega', label: 'Entrega' },
])
export const DEFAULT_DELIVERY_METHOD = DELIVERY_METHOD_OPTIONS[0].value
export const deliveryMethodOptions = (value) =>
  DELIVERY_METHOD_OPTIONS.some((option) => option.value === value) || !value
    ? DELIVERY_METHOD_OPTIONS
    : [...DELIVERY_METHOD_OPTIONS, { value, label: value }]
export const HNL_CURRENCY = 'HNL'
export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 200
