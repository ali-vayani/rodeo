"""API keys. Plaintext is returned once at issue time; only the SHA-256 is stored."""

import hashlib
import secrets
from dataclasses import dataclass

from psycopg import Connection

from gpu.ids import new_id

PREFIX_LEN = 12  # "ftgpu_" + 6 chars, enough to tell keys apart in a list


def hash_key(plaintext: str) -> str:
    return hashlib.sha256(plaintext.encode()).hexdigest()


@dataclass(frozen=True)
class IssuedKey:
    id: str
    team_id: str
    plaintext: str
    prefix: str


def issue_key(conn: Connection, team_id: str) -> IssuedKey:
    plaintext = "ftgpu_" + secrets.token_urlsafe(32)
    prefix = plaintext[:PREFIX_LEN]
    key_id = new_id()
    conn.execute(
        """
        INSERT INTO "ApiKey" ("id", "teamId", "keyHash", "keyPrefix", "createdAt")
        VALUES (%s, %s, %s, %s, timezone('utc', now()))
        """,
        (key_id, team_id, hash_key(plaintext), prefix),
    )
    return IssuedKey(id=key_id, team_id=team_id, plaintext=plaintext, prefix=prefix)


def resolve_key(conn: Connection, plaintext: str) -> str | None:
    """Return the owning team id for a live key, stamping lastUsedAt, or None."""
    row = conn.execute(
        """
        UPDATE "ApiKey" SET "lastUsedAt" = timezone('utc', now())
        WHERE "keyHash" = %s AND "revokedAt" IS NULL
        RETURNING "teamId"
        """,
        (hash_key(plaintext),),
    ).fetchone()
    return row["teamId"] if row else None
