# asyncio runs Alembic's asynchronous migration environment.
import asyncio

# fileConfig configures migration logging from alembic.ini.
from logging.config import fileConfig

# Alembic context provides offline and online migration execution.
from alembic import context

# pool and async_engine_from_config create the temporary migration engine.
from sqlalchemy import pool
from sqlalchemy.ext.asyncio import async_engine_from_config

# Base contains the combined metadata Alembic compares against SQLite.
from app.db.base import Base

# Importing the models registers chats and messages in Base.metadata.
from app.db.models import Chat, Message

# Central settings provide the same DATABASE_URL used by the application.
from app.core.config import get_settings


# Alembic's Config object reads configuration from alembic.ini.
config = context.config


# Configure migration loggers when an Alembic config file is available.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)


# Load IntraCore's cached application settings.
settings = get_settings()


# Force Alembic to use the central database URL instead of duplicating it.
config.set_main_option(
    "sqlalchemy.url",
    settings.database_url,
)


# Alembic uses this metadata to detect model-to-database differences.
target_metadata = Base.metadata


# Configure migrations that generate SQL without opening a database connection.
def run_migrations_offline() -> None:
    # Read the configured database URL.
    url = config.get_main_option("sqlalchemy.url")

    # Configure Alembic for URL-only migration generation.
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={
            "paramstyle": "named",
        },
        compare_type=True,
    )

    # Run all pending migrations inside one transaction context.
    with context.begin_transaction():
        context.run_migrations()


# Configure and execute migrations using a real database connection.
def do_run_migrations(connection: object) -> None:
    # Give Alembic the active connection and model metadata.
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        render_as_batch=True,
    )

    # Apply pending migration operations transactionally.
    with context.begin_transaction():
        context.run_migrations()


# Create an async engine and bridge its connection into Alembic.
async def run_async_migrations() -> None:
    # Build the migration engine from the sqlalchemy section of alembic.ini.
    connectable = async_engine_from_config(
        config.get_section(
            config.config_ini_section,
            {},
        ),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    # Open one asynchronous database connection.
    async with connectable.connect() as connection:
        # Run Alembic's synchronous migration operations through the
        # asynchronous SQLAlchemy connection.
        await connection.run_sync(do_run_migrations)

    # Dispose engine resources after the command completes.
    await connectable.dispose()


# Select offline or online execution based on the Alembic command.
if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_async_migrations())