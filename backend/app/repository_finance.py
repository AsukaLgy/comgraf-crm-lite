"""Financial balance calculations and SQL predicates shared by CRM views."""
from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import and_, case as sql_case, func, select

from .config import settings
from .models import Case, Ledger, Production


def today():
    return datetime.now(ZoneInfo(settings.app_timezone)).date()


def balance(db, case_id, production_id=None):
    query = select(Ledger).where(Ledger.case_id == case_id)
    if production_id is not None:
        query = query.where(Ledger.production_id == production_id)
    entries = list(db.scalars(query.order_by(Ledger.id)))
    production_currencies = []
    if production_id is None:
        production_currencies = list(db.execute(
            select(Production.id, Production.currency).where(Production.case_id == case_id)
        ))
        currencies = {currency for _, currency in production_currencies}
        if not currencies:
            currencies = {entry.currency for entry in entries}
        if len(currencies) > 1:
            return {
                'balance': None, 'overdue_balance': None, 'payment_status': 'Saldo por orden',
                'financial_by_currency': {
                    currency: str(sum((entry.amount for entry in entries if entry.currency == currency), Decimal('0')))
                    for currency in sorted(currencies)
                },
            }
    elif entries and len({entry.currency for entry in entries}) > 1:
        currencies = {entry.currency for entry in entries}
        return {
            'balance': None, 'overdue_balance': None, 'payment_status': 'Revisión de moneda',
            'financial_by_currency': {
                currency: str(sum((entry.amount for entry in entries if entry.currency == currency), Decimal('0')))
                for currency in sorted(currencies)
            },
        }
    total = sum((entry.amount for entry in entries), Decimal('0'))
    # No se trasladan créditos entre OP: coincide con los filtros operativos por orden.
    groups = {}
    if production_id is not None:
        groups[production_id] = entries
    else:
        for entry in entries:
            groups.setdefault(entry.production_id, []).append(entry)
        for order_id, _currency in production_currencies:
            groups.setdefault(order_id, [])
    overdue = Decimal('0')
    has_debt = has_credit = False
    for order_entries in groups.values():
        order_balance = sum((entry.amount for entry in order_entries), Decimal('0'))
        overdue_charges = sum((entry.amount for entry in order_entries
                               if entry.amount > 0 and entry.due_date and entry.due_date < today()), Decimal('0'))
        credits = -sum((entry.amount for entry in order_entries if entry.amount < 0), Decimal('0'))
        overdue += max(Decimal('0'), min(order_balance, overdue_charges - credits))
        has_debt = has_debt or order_balance > 0
        has_credit = has_credit or order_balance < 0
    return {
        'balance': str(total),
        'overdue_balance': str(overdue),
        'payment_status': 'Vencido' if overdue > 0 else 'Pendiente' if has_debt else 'A favor' if has_credit else 'Pagado',
    }


def financial_expressions():
    amount = Ledger.amount
    raw_total = func.coalesce(
        select(func.sum(amount)).where(Ledger.case_id == Case.id).correlate(Case).scalar_subquery(), 0
    )
    production_currency_count = select(func.count(func.distinct(Production.currency))).where(
        Production.case_id == Case.id
    ).correlate(Case).scalar_subquery()
    ledger_currency_count = select(func.count(func.distinct(Ledger.currency))).where(
        Ledger.case_id == Case.id
    ).correlate(Case).scalar_subquery()
    one_currency = and_(production_currency_count <= 1, ledger_currency_count <= 1)
    total = sql_case((one_currency, raw_total), else_=None)
    order_total = func.coalesce(select(func.sum(Ledger.amount)).where(
        Ledger.production_id == Production.id, Ledger.currency == Production.currency,
    ).correlate(Production).scalar_subquery(), 0)
    order_overdue_charges = func.coalesce(select(func.sum(sql_case((
        and_(Ledger.amount > 0, Ledger.due_date < today()), Ledger.amount,
    ), else_=0))).where(
        Ledger.production_id == Production.id, Ledger.currency == Production.currency,
    ).correlate(Production).scalar_subquery(), 0)
    order_credits = func.coalesce(select(func.sum(sql_case((Ledger.amount < 0, -Ledger.amount), else_=0))).where(
        Ledger.production_id == Production.id, Ledger.currency == Production.currency,
    ).correlate(Production).scalar_subquery(), 0)
    order_overdue = func.greatest(0, func.least(order_total, func.greatest(0, order_overdue_charges - order_credits)))
    overdue_total = func.coalesce(select(func.sum(order_overdue)).where(
        Production.case_id == Case.id,
    ).correlate(Case).scalar_subquery(), 0)
    cancellation_review = select(Production.case_id).where(
        Production.case_id == Case.id,
        Production.cancelled_at.is_not(None),
        Production.cancellation_review_pending.is_(True),
    ).correlate(Case).exists()
    has_debt, has_credit, has_overdue = financial_status_predicates()
    overdue = sql_case((cancellation_review, 0), (one_currency, overdue_total), else_=None)
    payment = sql_case(
        (cancellation_review, 'Revisión de anulación'), (has_overdue, 'Vencido'),
        (has_debt, 'Pendiente'), (has_credit, 'A favor'), else_='Pagado',
    )
    return total, overdue, payment, has_debt, has_credit, has_overdue


def financial_status_predicates():
    current = select(func.coalesce(func.sum(Ledger.amount), 0)).where(
        Ledger.production_id == Production.id, Ledger.currency == Production.currency,
    ).correlate(Production).scalar_subquery()
    overdue_charges = select(func.coalesce(func.sum(sql_case((
        and_(Ledger.amount > 0, Ledger.due_date < today()), Ledger.amount,
    ), else_=0)), 0)).where(
        Ledger.production_id == Production.id, Ledger.currency == Production.currency,
    ).correlate(Production).scalar_subquery()
    credits = select(func.coalesce(func.sum(sql_case((Ledger.amount < 0, -Ledger.amount), else_=0)), 0)).where(
        Ledger.production_id == Production.id, Ledger.currency == Production.currency,
    ).correlate(Production).scalar_subquery()
    order_overdue = func.least(current, func.greatest(0, overdue_charges - credits))
    debt = select(Production.id).where(
        Production.case_id == Case.id, current > 0,
    ).correlate(Case).exists()
    credit = select(Production.id).where(
        Production.case_id == Case.id, current < 0,
    ).correlate(Case).exists()
    overdue = select(Production.id).where(
        Production.case_id == Case.id, current > 0, order_overdue > 0,
    ).correlate(Case).exists()
    return debt, credit, overdue
