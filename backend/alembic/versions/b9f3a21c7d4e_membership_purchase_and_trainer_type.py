"""membership purchase date and trainer type

Revision ID: b9f3a21c7d4e
Revises: a1b6df68ef86
Create Date: 2026-04-29

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b9f3a21c7d4e"
down_revision: Union[str, Sequence[str], None] = "a1b6df68ef86"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    with op.batch_alter_table("memberships") as batch_op:
        batch_op.add_column(sa.Column("purchased_at", sa.DateTime(), nullable=True))

    if bind.dialect.name == "postgresql":
        op.execute(
            "UPDATE memberships "
            "SET purchased_at = COALESCE(created_at, starts_on::timestamp, NOW()::timestamp) "
            "WHERE purchased_at IS NULL"
        )
    else:
        op.execute(
            "UPDATE memberships "
            "SET purchased_at = COALESCE(created_at, starts_on, CURRENT_TIMESTAMP) "
            "WHERE purchased_at IS NULL"
        )

    with op.batch_alter_table("memberships") as batch_op:
        batch_op.alter_column("purchased_at", existing_type=sa.DateTime(), nullable=False)

    with op.batch_alter_table("instructors") as batch_op:
        batch_op.add_column(
            sa.Column("trainer_type", sa.String(length=16), nullable=False, server_default="club")
        )

    op.execute(
        "UPDATE instructors "
        "SET trainer_type = 'club' "
        "WHERE trainer_type IS NULL OR trainer_type = ''"
    )

    with op.batch_alter_table("instructors") as batch_op:
        batch_op.alter_column("trainer_type", existing_type=sa.String(length=16), server_default=None)


def downgrade() -> None:
    with op.batch_alter_table("instructors") as batch_op:
        batch_op.drop_column("trainer_type")

    with op.batch_alter_table("memberships") as batch_op:
        batch_op.drop_column("purchased_at")
