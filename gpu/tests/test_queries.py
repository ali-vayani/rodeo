from concurrent.futures import ThreadPoolExecutor

from gpu.jobs import queries
from gpu.jobs.models import JobSpec, JobState
from gpu.jobs.queries import CancelResult


def spec(**overrides) -> JobSpec:
    base = dict(image="ghcr.io/x/y:1", command=["sleep", "1"], input_key=None, max_runtime_seconds=10)
    base.update(overrides)
    return JobSpec(**base)


def create(pool, team, key=None, **overrides):
    with pool.connection() as conn:
        return queries.create_job(conn, team, spec(**overrides), key)[0]


def state_of(pool, job_id) -> JobState:
    with pool.connection() as conn:
        return JobState(conn.execute('SELECT "state" FROM "Job" WHERE "id" = %s', (job_id,)).fetchone()["state"])


def test_create_and_get_is_team_scoped(pool, team, other_team):
    job = create(pool, team)
    assert job.state is JobState.QUEUED
    with pool.connection() as conn:
        assert queries.get_job(conn, team, job.id) == job
        assert queries.get_job(conn, other_team, job.id) is None
        assert [j.id for j in queries.list_jobs(conn, team)] == [job.id]
        assert queries.list_jobs(conn, other_team) == []


def test_concurrent_duplicate_submissions_create_one_job(pool, team):
    def submit(_):
        with pool.connection() as conn:
            return queries.create_job(conn, team, spec(), "retry-123")

    with ThreadPoolExecutor(8) as ex:
        results = list(ex.map(submit, range(8)))
    assert len({job.id for job, _ in results}) == 1
    assert sum(created for _, created in results) == 1


def test_same_idempotency_key_is_per_team(pool, team, other_team):
    a = create(pool, team, key="k")
    b = create(pool, other_team, key="k")
    assert a.id != b.id


def test_concurrent_claims_never_share_a_job(pool, team):
    jobs = [create(pool, team) for _ in range(5)]

    def claim(i):
        with pool.connection() as conn:
            return queries.claim_next(conn, f"w{i}")

    with ThreadPoolExecutor(8) as ex:
        claimed = [c for c in ex.map(claim, range(8)) if c is not None]
    ids = [job.id for job, _ in claimed]
    assert sorted(ids) == sorted(j.id for j in jobs)
    assert len(set(ids)) == 5
    for job, attempt in claimed:
        assert job.state is JobState.STARTING
        assert job.current_attempt_id == attempt.id
        assert attempt.job_id == job.id


def test_claim_takes_oldest_first(pool, team):
    first = create(pool, team)
    create(pool, team)
    with pool.connection() as conn:
        job, _ = queries.claim_next(conn, "w")
    assert job.id == first.id


def test_claim_on_empty_queue(pool):
    with pool.connection() as conn:
        assert queries.claim_next(conn, "w") is None


def test_cancel_queued_job_is_immediate(pool, team):
    job = create(pool, team)
    with pool.connection() as conn:
        assert queries.request_cancel(conn, team, job.id) is CancelResult.CANCELLED
        assert queries.request_cancel(conn, team, job.id) is CancelResult.TERMINAL
    assert state_of(pool, job.id) is JobState.CANCELLED
    with pool.connection() as conn:
        assert queries.claim_next(conn, "w") is None


def test_cancel_active_job_is_a_request_until_worker_finishes(pool, team):
    job = create(pool, team)
    with pool.connection() as conn:
        _, attempt = queries.claim_next(conn, "w")
        assert queries.request_cancel(conn, team, job.id) is CancelResult.REQUESTED
        assert queries.request_cancel(conn, team, job.id) is CancelResult.ALREADY_REQUESTED
        assert queries.get_job(conn, team, job.id).cancel_requested_at is not None
    assert state_of(pool, job.id) is JobState.STARTING
    with pool.connection() as conn:
        assert queries.heartbeat(conn, attempt.id) is True  # cancel flag reaches the worker
        assert queries.finish(conn, attempt.id, JobState.CANCELLED, 137, "workload")
    assert state_of(pool, job.id) is JobState.CANCELLED


def test_cancel_is_team_scoped(pool, team, other_team):
    job = create(pool, team)
    with pool.connection() as conn:
        assert queries.request_cancel(conn, other_team, job.id) is CancelResult.NOT_FOUND
        assert queries.request_cancel(conn, team, "nope") is CancelResult.NOT_FOUND
    assert state_of(pool, job.id) is JobState.QUEUED


def test_stale_finish_cannot_overwrite_terminal_state(pool, team):
    job = create(pool, team)
    with pool.connection() as conn:
        _, attempt = queries.claim_next(conn, "w")
        assert queries.mark_running(conn, attempt.id, "ctr", "sha256:abc")
        assert queries.finish(conn, attempt.id, JobState.SUCCEEDED, 0, None) is True
        assert queries.finish(conn, attempt.id, JobState.FAILED, 1, "workload") is False
        assert queries.heartbeat(conn, attempt.id) is False
        saved = queries.get_attempt(conn, attempt.id)
    assert state_of(pool, job.id) is JobState.SUCCEEDED
    assert saved.exit_code == 0 and saved.finished_at is not None
    assert saved.container_id == "ctr" and saved.image_digest == "sha256:abc"
