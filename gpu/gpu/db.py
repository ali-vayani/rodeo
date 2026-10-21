"""Connection pool. `with pool.connection() as conn:` commits on clean exit and rolls
back on exception, so each query function runs as one transaction."""

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool


def make_pool(database_url: str, max_size: int = 8) -> ConnectionPool:
    return ConnectionPool(
        database_url,
        min_size=1,
        max_size=max_size,
        kwargs={"row_factory": dict_row},
        open=True,
    )
