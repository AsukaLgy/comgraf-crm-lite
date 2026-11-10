"""Allow an unknown payment due date without inventing one."""
from alembic import op
import sqlalchemy as sa

revision = '018_optional_payment_due'
down_revision = '017_definitive_deletion'
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column('productions', 'payment_due_date', existing_type=sa.Date(), nullable=True)


def downgrade():
    # Downgrade requires resolving NULL dates explicitly; no date is fabricated here.
    op.alter_column('productions', 'payment_due_date', existing_type=sa.Date(), nullable=False)
