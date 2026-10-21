"""Prisma's `@default(cuid())` is applied client-side, so rows inserted from Python
need their own ids. These are the same shape: a leading `c` and 24 base-36 chars."""

import secrets
import string

_ALPHABET = string.digits + string.ascii_lowercase


def new_id() -> str:
    return "c" + "".join(secrets.choice(_ALPHABET) for _ in range(24))
