# DeclarativeBase is SQLAlchemy 2.x's modern base class for ORM models.
# Every durable database model in IntraCore will inherit from this class.
from sqlalchemy.orm import DeclarativeBase


# Base owns the shared SQLAlchemy metadata containing all registered tables.
# Alembic will later inspect Base.metadata to generate database migrations.
class Base(DeclarativeBase):
    pass