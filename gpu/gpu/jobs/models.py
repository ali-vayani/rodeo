"""Row snapshots. These are for display and for handing data between functions. No
decision about a state transition is made from them; every transition is a conditional
UPDATE in queries.py that checks the state it expects to find."""

from dataclasses import dataclass
from datetime import datetime, timezone
from enum import StrEnum


class JobState(StrEnum):
    QUEUED = "QUEUED"
    STARTING = "STARTING"
    RUNNING = "RUNNING"
    UNKNOWN = "UNKNOWN"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    TIMED_OUT = "TIMED_OUT"
    CANCELLED = "CANCELLED"


TERMINAL_STATES = frozenset(
    {JobState.SUCCEEDED, JobState.FAILED, JobState.TIMED_OUT, JobState.CANCELLED}
)

# States a worker may move a job out of when it finishes an attempt.
ACTIVE_STATES = frozenset({JobState.STARTING, JobState.RUNNING, JobState.UNKNOWN})


@dataclass(frozen=True)
class JobSpec:
    """What the client submits."""

    image: str
    command: list[str]
    input_key: str | None
    max_runtime_seconds: int


@dataclass(frozen=True)
class Job:
    id: str
    team_id: str
    image: str
    command: list[str]
    input_key: str | None
    max_runtime_seconds: int
    state: JobState
    idempotency_key: str | None
    cancel_requested_at: datetime | None
    created_at: datetime
    current_attempt_id: str | None


@dataclass(frozen=True)
class JobAttempt:
    id: str
    job_id: str
    worker_id: str
    container_id: str | None
    image_digest: str | None
    started_at: datetime
    last_heartbeat_at: datetime | None
    finished_at: datetime | None
    exit_code: int | None
    error_kind: str | None


def _utc(value: datetime | None) -> datetime | None:
    # Columns are TIMESTAMP(3) without time zone and Prisma writes UTC into them.
    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=timezone.utc)


def job_from_row(row: dict) -> Job:
    return Job(
        id=row["id"],
        team_id=row["teamId"],
        image=row["image"],
        command=list(row["command"] or []),
        input_key=row["inputKey"],
        max_runtime_seconds=row["maxRuntimeSeconds"],
        state=JobState(row["state"]),
        idempotency_key=row["idempotencyKey"],
        cancel_requested_at=_utc(row["cancelRequestedAt"]),
        created_at=_utc(row["createdAt"]),
        current_attempt_id=row["currentAttemptId"],
    )


def attempt_from_row(row: dict) -> JobAttempt:
    return JobAttempt(
        id=row["id"],
        job_id=row["jobId"],
        worker_id=row["workerId"],
        container_id=row["containerId"],
        image_digest=row["imageDigest"],
        started_at=_utc(row["startedAt"]),
        last_heartbeat_at=_utc(row["lastHeartbeatAt"]),
        finished_at=_utc(row["finishedAt"]),
        exit_code=row["exitCode"],
        error_kind=row["errorKind"],
    )
