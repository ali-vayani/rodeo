"""Bearer-key auth as a FastAPI dependency. A job route receives `team_id` or does not
run, so forgetting the check is a missing parameter rather than an open endpoint."""

from typing import Annotated

from fastapi import Depends, HTTPException, Request, status

from gpu.jobs.keys import resolve_key


def current_team(request: Request) -> str:
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing bearer token")
    with request.app.state.pool.connection() as conn:
        team_id = resolve_key(conn, token.strip())
    if team_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid or revoked API key")
    return team_id


TeamId = Annotated[str, Depends(current_team)]
