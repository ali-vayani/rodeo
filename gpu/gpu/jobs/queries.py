"""One function per operation, each run inside the caller's transaction (the pool's
`connection()` context commits on exit). Every state transition is a single UPDATE whose
WHERE clause names the state it expects, so a stale caller changes zero rows instead of
clobbering a newer transition. Team scoping lives in the SQL, never in Python filters."""

from enum import StrEnum

from psycopg import Connection

from gpu.ids import new_id
from gpu.jobs.models import (
    ACTIVE_STATES,
    Job,
    JobAttempt,
    JobSpec,
    JobState,
    attempt_from_row,
    job_from_row,
)

_JOB_COLS = (
    '"id", "teamId", "image", "command", "inputKey", "maxRuntimeSeconds", "state", '
    '"idempotencyKey", "cancelRequestedAt", "createdAt", "currentAttemptId"'
)
_ATTEMPT_COLS = (
    '"id", "jobId", "workerId", "containerId", "imageDigest", "startedAt", '
    '"lastHeartbeatAt", "finishedAt", "exitCode", "errorKind"'
)
_NOW = "timezone('utc', now())"


# --- submission side -------------------------------------------------------------


def create_job(
    conn: Connection, team_id: str, spec: JobSpec, idempotency_key: str | None
) -> tuple[Job, bool]:
    """Insert a QUEUED job. With an idempotency key, a repeat returns the existing job
    and `created=False`; the unique index makes concurrent duplicates collapse to one."""
    row = conn.execute(
        f"""
        INSERT INTO "Job" ("id", "teamId", "image", "command", "inputKey",
                           "maxRuntimeSeconds", "idempotencyKey", "createdAt")
        VALUES (%s, %s, %s, %s, %s, %s, %s, {_NOW})
        ON CONFLICT ("teamId", "idempotencyKey") DO NOTHING
        RETURNING {_JOB_COLS}
        """,
        (
            new_id(),
            team_id,
            spec.image,
            spec.command,
            spec.input_key,
            spec.max_runtime_seconds,
            idempotency_key,
        ),
    ).fetchone()
    if row is not None:
        return job_from_row(row), True
    row = conn.execute(
        f'SELECT {_JOB_COLS} FROM "Job" WHERE "teamId" = %s AND "idempotencyKey" = %s',
        (team_id, idempotency_key),
    ).fetchone()
    return job_from_row(row), False


def get_job(conn: Connection, team_id: str, job_id: str) -> Job | None:
    row = conn.execute(
        f'SELECT {_JOB_COLS} FROM "Job" WHERE "id" = %s AND "teamId" = %s',
        (job_id, team_id),
    ).fetchone()
    return job_from_row(row) if row else None


def list_jobs(conn: Connection, team_id: str, limit: int = 100) -> list[Job]:
    rows = conn.execute(
        f"""
        SELECT {_JOB_COLS} FROM "Job"
        WHERE "teamId" = %s
        ORDER BY "createdAt" DESC, "id" DESC
        LIMIT %s
        """,
        (team_id, limit),
    ).fetchall()
    return [job_from_row(r) for r in rows]


def get_attempt(conn: Connection, attempt_id: str) -> JobAttempt | None:
    row = conn.execute(
        f'SELECT {_ATTEMPT_COLS} FROM "JobAttempt" WHERE "id" = %s', (attempt_id,)
    ).fetchone()
    return attempt_from_row(row) if row else None


class CancelResult(StrEnum):
    CANCELLED = "cancelled"  # was QUEUED; now CANCELLED
    REQUESTED = "requested"  # active; worker will stop it and finalize
    ALREADY_REQUESTED = "already_requested"
    TERMINAL = "terminal"  # nothing to cancel
    NOT_FOUND = "not_found"


def request_cancel(conn: Connection, team_id: str, job_id: str) -> CancelResult:
    """Cancel outright if still queued. If an attempt is active, record the request
    and leave the state alone: only the worker may finalize once execution stops."""
    cur = conn.execute(
        """
        UPDATE "Job" SET "state" = 'CANCELLED'
        WHERE "id" = %s AND "teamId" = %s AND "state" = 'QUEUED'
        """,
        (job_id, team_id),
    )
    if cur.rowcount == 1:
        return CancelResult.CANCELLED
    cur = conn.execute(
        f"""
        UPDATE "Job" SET "cancelRequestedAt" = {_NOW}
        WHERE "id" = %s AND "teamId" = %s
          AND "state" IN ('STARTING', 'RUNNING', 'UNKNOWN')
          AND "cancelRequestedAt" IS NULL
        """,
        (job_id, team_id),
    )
    if cur.rowcount == 1:
        return CancelResult.REQUESTED
    job = get_job(conn, team_id, job_id)
    if job is None:
        return CancelResult.NOT_FOUND
    if job.state in ACTIVE_STATES:
        return CancelResult.ALREADY_REQUESTED
    return CancelResult.TERMINAL


# --- worker side -----------------------------------------------------------------


def claim_next(conn: Connection, worker_id: str) -> tuple[Job, JobAttempt] | None:
    """Atomically take the oldest QUEUED job. SKIP LOCKED lets concurrent workers pass
    over rows another transaction is claiming, so two workers never get the same job."""
    row = conn.execute(
        f"""
        SELECT {_JOB_COLS} FROM "Job"
        WHERE "state" = 'QUEUED'
        ORDER BY "createdAt", "id"
        LIMIT 1
        FOR UPDATE SKIP LOCKED
        """
    ).fetchone()
    if row is None:
        return None
    job = job_from_row(row)
    attempt_row = conn.execute(
        f"""
        INSERT INTO "JobAttempt" ("id", "jobId", "workerId", "startedAt", "lastHeartbeatAt")
        VALUES (%s, %s, %s, {_NOW}, {_NOW})
        RETURNING {_ATTEMPT_COLS}
        """,
        (new_id(), job.id, worker_id),
    ).fetchone()
    attempt = attempt_from_row(attempt_row)
    row = conn.execute(
        f"""
        UPDATE "Job" SET "state" = 'STARTING', "currentAttemptId" = %s
        WHERE "id" = %s AND "state" = 'QUEUED'
        RETURNING {_JOB_COLS}
        """,
        (attempt.id, job.id),
    ).fetchone()
    return job_from_row(row), attempt


def mark_running(
    conn: Connection, attempt_id: str, container_id: str | None, image_digest: str | None
) -> bool:
    conn.execute(
        """
        UPDATE "JobAttempt" SET "containerId" = %s, "imageDigest" = %s
        WHERE "id" = %s AND "finishedAt" IS NULL
        """,
        (container_id, image_digest, attempt_id),
    )
    cur = conn.execute(
        """
        UPDATE "Job" SET "state" = 'RUNNING'
        WHERE "currentAttemptId" = %s AND "state" = 'STARTING'
        """,
        (attempt_id,),
    )
    return cur.rowcount == 1


def heartbeat(conn: Connection, attempt_id: str) -> bool:
    """Stamp the attempt and report whether cancellation has been requested. Returns
    False only if the attempt is already finished, which means the worker is stale."""
    cur = conn.execute(
        f"""
        UPDATE "JobAttempt" SET "lastHeartbeatAt" = {_NOW}
        WHERE "id" = %s AND "finishedAt" IS NULL
        """,
        (attempt_id,),
    )
    if cur.rowcount != 1:
        return False
    row = conn.execute(
        'SELECT "cancelRequestedAt" FROM "Job" WHERE "currentAttemptId" = %s',
        (attempt_id,),
    ).fetchone()
    return row is not None and row["cancelRequestedAt"] is not None


def finish(
    conn: Connection,
    attempt_id: str,
    outcome: JobState,
    exit_code: int | None,
    error_kind: str | None,
) -> bool:
    """Close the attempt and move the job to a terminal state. The job update is
    conditional on this attempt still being current and the job still active, so a
    worker that was superseded or fenced changes nothing and learns that from the
    return value."""
    if outcome not in {
        JobState.SUCCEEDED,
        JobState.FAILED,
        JobState.TIMED_OUT,
        JobState.CANCELLED,
    }:
        raise ValueError(f"not a terminal outcome: {outcome}")
    conn.execute(
        f"""
        UPDATE "JobAttempt"
        SET "finishedAt" = {_NOW}, "exitCode" = %s, "errorKind" = %s
        WHERE "id" = %s AND "finishedAt" IS NULL
        """,
        (exit_code, error_kind, attempt_id),
    )
    cur = conn.execute(
        """
        UPDATE "Job" SET "state" = %s
        WHERE "currentAttemptId" = %s AND "state" IN ('STARTING', 'RUNNING', 'UNKNOWN')
        """,
        (outcome.value, attempt_id),
    )
    return cur.rowcount == 1
