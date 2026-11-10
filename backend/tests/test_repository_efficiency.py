from sqlalchemy import event

from app.db import engine
from test_workflows import create, conversion, mutate, must


def test_order_list_queries_are_bounded(clients):
    admin = clients['admin']
    for index in range(5):
        _, case = create(admin, f'Listado de OP {index}')
        mutate(admin, case, 'convert', conversion())

    statements = []

    def observe(_connection, _cursor, statement, _parameters, _context, _many):
        if statement.lstrip().upper().startswith('SELECT'):
            statements.append(statement)

    event.listen(engine, 'before_cursor_execute', observe)
    try:
        result = must(clients['printer'].get('/api/orders?view=production&page_size=100'))
    finally:
        event.remove(engine, 'before_cursor_execute', observe)
    assert len(result['items']) == 5
    assert all(row['item_count'] == 1 and row['pending_quantities'] for row in result['items'])
    assert len(statements) <= 15, f'El listado ejecutó {len(statements)} SELECT para cinco OP'
    print(f'ORDER_LIST_SELECTS={len(statements)}')
