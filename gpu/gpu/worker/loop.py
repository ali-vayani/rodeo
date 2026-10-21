"""Claim, run, heartbeat, finish. One job at a time per worker; the GPU is exclusive."""

import logging
import time

from psycopg_pool import ConnectionPool

from gpu import storage
from gpu.config import Settings
from gpu.jobs import queries
from gpu.jobs.models import Job, JobAttempt, JobState
from gpu.worker.executor import AttemptPaths, Executor, ExitStatus

log = logging.getLogger(__name__)


def run_attempt(
    pool: ConnectionPool, settings: Settings, executor: Executor, job: Job, attempt: JobAttempt
) -> JobState:
    paths = AttemptPaths(
        input=(
            storage.input_path(settings.data_dir, job.team_id, job.input_key)
            if job.input_key
            else None
        ),
        log=storage.log_path(settings.data_dir, job.id, attempt.id),
        outputs=storage.outputs_dir(settings.data_dir, job.id, attempt.id),
    )
    paths.outputs.mkdir(parents=True, exist_ok=True)

    try:
        execution = executor.start(job, attempt, paths)
    except Exception as exc:  # could not even launch: that is on us, not the job
        log.exception("job %s attempt %s failed to start", job.id, attempt.id)
        with paths.log.open("a") as f:
            f.write(f"failed to start: {exc}\n")
        with pool.connection() as conn:
            queries.finish(conn, attempt.id, JobState.FAILED, None, "infrastructure")
        return JobState.FAILED

    with pool.connection() as conn:
        queries.mark_running(conn, attempt.id, execution.container_id, execution.image_digest)

    started = time.monotonic()
    deadline = started + job.max_runtime_seconds
    last_beat = started
    outcome: JobState | None = None
    status: ExitStatus | None = None

    while True:
        status = execution.poll()
        if status is not None:
            if outcome is None:
                outcome = JobState.SUCCEEDED if status.exit_code == 0 else JobState.FAILED
            break
        now = time.monotonic()
        if outcome is None and now >= deadline:
            log.info("job %s hit its deadline, killing", job.id)
            outcome = JobState.TIMED_OUT
            execution.kill()
        if now - last_beat >= settings.heartbeat_seconds:
            last_beat = now
            with pool.connection() as conn:
                cancel_requested = queries.heartbeat(conn, attempt.id)
            if cancel_requested and outcome is None:
                log.info("job %s cancel requested, killing", job.id)
                outcome = JobState.CANCELLED
                execution.kill()
        time.sleep(0.1)

    error_kind = None if outcome is JobState.SUCCEEDED else (
        "timeout" if outcome is JobState.TIMED_OUT else status.error_kind
    )
    with pool.connection() as conn:
        applied = queries.finish(conn, attempt.id, outcome, status.exit_code, error_kind)
    if not applied:
        log.warning("job %s attempt %s finished but was no longer current", job.id, attempt.id)
    return outcome


def run_once(pool: ConnectionPool, settings: Settings, executor: Executor) -> JobState | None:
    """Claim and run one job. Returns None when the queue is empty."""
    with pool.connection() as conn:
        claimed = queries.claim_next(conn, settings.worker_id)
    if claimed is None:
        return None
    job, attempt = claimed
    log.info("claimed job %s as attempt %s", job.id, attempt.id)
    return run_attempt(pool, settings, executor, job, attempt)


def run_forever(pool: ConnectionPool, settings: Settings, executor: Executor) -> None:
    log.info("worker %s polling every %.1fs", settings.worker_id, settings.poll_seconds)
    while True:
        if run_once(pool, settings, executor) is None:
            time.sleep(settings.poll_seconds)
