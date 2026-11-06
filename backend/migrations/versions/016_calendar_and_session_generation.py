"""Add explicit follow-up purpose and service-generation sessions."""
from alembic import op
import sqlalchemy as sa


revision = '016_cal_session_gen'
down_revision = '015_atomic_production_request'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('tasks', sa.Column('purpose', sa.String(length=20), nullable=False,
                                     server_default='ATTENTION'))
    # Existing sessions have no generation and are intentionally invalidated by
    # the first service generation after this migration.
    op.add_column('sessions', sa.Column('generation', sa.String(length=36), nullable=False,
                                        server_default=''))


def downgrade():
    op.drop_column('sessions', 'generation')
    op.drop_column('tasks', 'purpose')
