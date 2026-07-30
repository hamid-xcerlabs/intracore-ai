# event registers low-level connection hooks on SQLAlchemy engines.
# We use it to enable SQLite foreign-key enforcement on every connection.
from sqlalchemy import event, text

# AsyncEngine represents the shared asynchronous database engine.
# AsyncSession represents one unit of database work.
# async_sessionmaker creates reusable asynchronous sessions.
# create_async_engine creates the engine from the configured database URL.
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

# Import the central application configuration.
# This prevents the database URL from being hard-coded in this module.
from app.core.config import get_settings


# Load the cached backend settings.
settings = get_settings()


# Create the shared asynchronous database engine first.
# Every repository and future database service will depend on this engine.
engine: AsyncEngine = create_async_engine(
    # Read the SQLite connection URL from the central .env configuration.
    settings.database_url,

    # Disable raw SQL output during normal development.
    # This can later become a configurable debugging option.
    echo=False,
)


# Register the SQLite connection hook only after the engine exists.
# The decorator needs engine.sync_engine immediately when Python imports
# this file, so placing it before engine creation causes a NameError.
@event.listens_for(engine.sync_engine, "connect")
def enable_sqlite_foreign_keys(
    dbapi_connection: object,
    connection_record: object,
) -> None:
    # connection_record is required by SQLAlchemy's event function signature.
    # It is not currently used by IntraCore.
    del connection_record

    # Access the raw SQLite connection cursor.
    cursor = dbapi_connection.cursor()

    # Enable SQLite foreign-key constraints for this connection.
    # This allows ON DELETE CASCADE on chats and messages to work correctly.
    cursor.execute("PRAGMA foreign_keys=ON")

    # Close the temporary cursor after applying the connection setting.
    cursor.close()


# Create a reusable factory for future asynchronous database sessions.
# Routes should eventually use sessions through repositories or dependencies,
# rather than communicating with the engine directly.
AsyncSessionFactory = async_sessionmaker(
    # Bind all generated sessions to the shared database engine.
    bind=engine,

    # Produce AsyncSession instances for FastAPI's asynchronous architecture.
    class_=AsyncSession,

    # Keep ORM values available after a transaction is committed.
    expire_on_commit=False,
)


# Check whether the backend can connect to SQLite and execute a minimal query.
# This function belongs to the database infrastructure layer.
async def check_database_connection() -> dict[str, object]:
    try:
        # Open a temporary connection from the shared engine.
        async with engine.connect() as connection:
            # Execute a minimal query that does not depend on application tables.
            await connection.execute(text("SELECT 1"))

        # Return a successful diagnostic result to the health route.
        return {
            "connected": True,
            "database": "sqlite",
            "status": "ready",
        }

    except Exception as exc:
        # Return a controlled diagnostic response instead of crashing the route.
        return {
            "connected": False,
            "database": "sqlite",
            "status": "unavailable",
            "error": str(exc),
        }
        
        
        
        
        #work did after frontend UI live at step 10
        
        
        
# AsyncIterator describes an asynchronous dependency that yields one database
# session and performs cleanup after the HTTP request has finished.
from collections.abc import AsyncIterator


# FastAPI routes depend on this function whenever they need database access.
# One new AsyncSession is created per request because AsyncSession is mutable
# and must not be shared across concurrent requests.
async def get_database_session() -> AsyncIterator[AsyncSession]:
    # Open one short-lived session from the shared session factory.
    async with AsyncSessionFactory() as session:
        try:
            # Yield the active session to the API route or repository layer.
            yield session

        except Exception:
            # Undo uncommitted database changes when request processing fails.
            await session.rollback()

            # Re-raise the original exception so FastAPI can handle it.
            raise

        finally:
            # The async context manager also closes the session, but an
            # explicit close makes this lifecycle clear to future maintainers.
            await session.close()        