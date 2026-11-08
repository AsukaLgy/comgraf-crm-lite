"""Minimal deletion audit and deferred managed-file cleanup."""
from alembic import op
import sqlalchemy as sa

revision = '017_definitive_deletion'
down_revision = '016_cal_session_gen'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('deletion_audit', sa.Column('id', sa.Integer, primary_key=True), sa.Column('actor_id', sa.Integer, nullable=False), sa.Column('deleted_at', sa.DateTime, nullable=False), sa.Column('record_type', sa.String(20), nullable=False), sa.Column('record_id', sa.Integer, nullable=False))
    op.create_table('file_cleanup', sa.Column('id', sa.Integer, primary_key=True), sa.Column('storage_key', sa.String(80), nullable=False, unique=True), sa.Column('attempts', sa.Integer, nullable=False))


def downgrade():
    op.drop_table('file_cleanup')
    op.drop_table('deletion_audit')
