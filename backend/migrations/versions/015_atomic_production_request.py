"""Persist idempotency for atomic request plus production creation."""
from alembic import op
import sqlalchemy as sa


revision = '015_atomic_production_request'
down_revision = '014_nullable_case_origin'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'creation_requests',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('key', sa.String(length=80), nullable=False),
        sa.Column('request_hash', sa.String(length=64), nullable=False),
        sa.Column('case_id', sa.Integer(), sa.ForeignKey('cases.id'), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.UniqueConstraint('user_id', 'key'),
    )


def downgrade():
    op.drop_table('creation_requests')
