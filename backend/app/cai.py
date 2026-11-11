from decimal import Decimal

CAI_FORMATS = {
    'Media carta': ('5.5', '8.5'),
    'Cuarto de carta': ('4.25', '5.5'),
    '8.5 × 7.25': ('8.5', '7.25'),
    '8.5 × 8.5': ('8.5', '8.5'),
    'Carta': ('8.5', '11'),
}
CAI_GAMES_PRESETS = (25, 50)
MAX_GAMES_PER_PAD = 10000
CAI_PAPERS = {'Bond', 'Químico'}
CAI_COPIES = {1, 2, 3}
CAI_BINDINGS = {'Engrapado', 'Pegado', 'Hojas sueltas'}
FISCAL_DOCUMENT_TYPES = (
    'Factura',
    'Factura prevalorada',
    'Recibo por honorarios profesionales',
    'Boleta de compra',
    'Constancia de donación',
    'Nota de crédito',
    'Nota de débito',
    'Guía de remisión',
    'Comprobante de retención',
)
LEGACY_CAI_PRODUCT = 'Talonarios de factura CAI'
CAI_PRODUCT = 'Talonario CAI'
CATALOG_REVISION = 3
LEGACY_CAI_PRODUCTS = frozenset({'Recibos por honorarios (CAI)', 'Facturas (CAI)', 'Otros (CAI)', LEGACY_CAI_PRODUCT})
CAI_PRODUCTS = LEGACY_CAI_PRODUCTS | {CAI_PRODUCT}
PRINT_FORM_PRODUCTS = CAI_PRODUCTS | {'Talonarios y facturas'}
NEW_PRODUCTS = ('Tarjetas de presentación', 'Talonarios y facturas', CAI_PRODUCT, 'Volantes y flyers', 'Libretas y cuadernos',
                'Banners y lonas', 'Otros trabajos')


def is_cai_product(product):
    return product in CAI_PRODUCTS


def uses_print_form(product):
    return product in PRINT_FORM_PRODUCTS


def new_order_product(product):
    return CAI_PRODUCT if product in LEGACY_CAI_PRODUCTS else product


def cai_summary(item):
    """Derived finished-product counts; commercial quantity remains talonarios."""
    if not uses_print_form(item.get('product')):
        return None
    specs = item.get('specs') or {}
    try:
        pads = Decimal(str(item['quantity']))
        games = pads * int(specs['games_per_pad'])
        sheets_per_game = 1 + int(specs['additional_copies'])
    except (KeyError, TypeError, ValueError, ArithmeticError):
        return None
    return {
        'total_games': int(games),
        'sheets_per_game': sheets_per_game,
        'finished_sheets': int(games) * sheets_per_game,
    }
