"""Allow new cases without an invented origin channel; keep historical values."""
from alembic import op
import sqlalchemy as sa


revision = '014_nullable_case_origin'
down_revision = '013_mail_reliability'
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column('cases', 'channel', existing_type=sa.String(length=30), nullable=True)


def downgrade():
    connection = op.get_bind()
    if connection.execute(sa.text('SELECT COUNT(*) FROM cases WHERE channel IS NULL')).scalar_one():
        raise RuntimeError('No se puede exigir canal de origen: hay solicitudes nuevas sin canal. Restaura el respaldo conjunto si necesitas volver al esquema anterior.')
    op.alter_column('cases', 'channel', existing_type=sa.String(length=30), nullable=False)
