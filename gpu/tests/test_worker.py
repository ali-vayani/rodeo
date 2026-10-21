import threading
import time

from gpu.jobs import queries
from gpu.jobs.models import JobState
from gpu.jobs.queries import CancelResult
from gpu.worker.fake import FakeExecutor
from gpu.worker.loop import run_once
from tests.conftest import auth, job_body


def submit(client, api_key, **overrides) -> str:
    r = client.post("/jobs", json=job_body(**overrides), headers=auth(api_key))
    assert r.status_code == 201, r.text
    return r.json()["id"]


def fetch(client, api_key, job_id) -> dict:
    return client.get(f"/jobs/{job_id}", headers=auth(api_key)).json()


def attempt_of(pool, job):
    with pool.connection() as conn:
        return queries.get_attempt(conn, job["current_attempt_id"])


def test_empty_queue(pool, settings):
    assert run_once(pool, settings, FakeExecutor()) is None


def test_success_records_exit_and_logs(client, api_key, pool, settings):
    job_id = submit(client, api_key, command=["sleep", "0.2"])
    assert run_once(pool, settings, FakeExecutor()) is JobState.SUCCEEDED
    job = fetch(client, api_key, job_id)
    assert job["state"] == "SUCCEEDED"
    attempt = attempt_of(pool, job)
    assert attempt.exit_code == 0 and attempt.error_kind is None
    assert attempt.finished_at is not None and attempt.last_heartbeat_at is not None
    logs = client.get(f"/jobs/{job_id}/logs", headers=auth(api_key))
    assert logs.status_code == 200 and "done" in logs.text


def test_nonzero_exit_is_a_workload_failure(client, api_key, pool, settings):
    job_id = submit(client, api_key, command=["fail", "0", "3"])
    assert run_once(pool, settings, FakeExecutor()) is JobState.FAILED
    job = fetch(client, api_key, job_id)
    attempt = attempt_of(pool, job)
    assert job["state"] == "FAILED" and attempt.exit_code == 3 and attempt.error_kind == "workload"


def test_deadline_kills_and_times_out(client, api_key, pool, settings):
    job_id = submit(client, api_key, command=["hang"], max_runtime_seconds=1)
    started = time.monotonic()
    assert run_once(pool, settings, FakeExecutor()) is JobState.TIMED_OUT
    assert time.monotonic() - started < 5
    job = fetch(client, api_key, job_id)
    assert job["state"] == "TIMED_OUT" and attempt_of(pool, job).error_kind == "timeout"


def test_cancel_while_running_stops_execution_first(client, api_key, pool, settings):
    job_id = submit(client, api_key, command=["hang"], max_runtime_seconds=30)
    result = {}
    worker = threading.Thread(
        target=lambda: result.update(outcome=run_once(pool, settings, FakeExecutor()))
    )
    worker.start()
    for _ in range(100):
        if fetch(client, api_key, job_id)["state"] == "RUNNING":
            break
        time.sleep(0.05)
    r = client.post(f"/jobs/{job_id}/cancel", headers=auth(api_key))
    assert r.status_code == 200
    assert r.json()["state"] == "RUNNING"  # a request, not yet a cancellation
    assert r.json()["cancel_requested_at"] is not None
    worker.join(timeout=10)
    assert result["outcome"] is JobState.CANCELLED
    assert fetch(client, api_key, job_id)["state"] == "CANCELLED"
    with pool.connection() as conn:
        assert queries.request_cancel(conn, _team(pool, job_id), job_id) is CancelResult.TERMINAL


def _team(pool, job_id) -> str:
    with pool.connection() as conn:
        return conn.execute('SELECT "teamId" FROM "Job" WHERE "id" = %s', (job_id,)).fetchone()["teamId"]


def test_outputs_are_listed_and_downloadable(client, api_key, pool, settings):
    job_id = submit(client, api_key, command=["write", "result.txt"])
    assert run_once(pool, settings, FakeExecutor()) is JobState.SUCCEEDED
    listing = client.get(f"/jobs/{job_id}/outputs", headers=auth(api_key)).json()
    assert [f["path"] for f in listing] == ["result.txt"]
    body = client.get(f"/jobs/{job_id}/outputs/result.txt", headers=auth(api_key))
    assert body.status_code == 200 and body.text.startswith("hello")
    assert client.get(f"/jobs/{job_id}/outputs/../log.txt", headers=auth(api_key)).status_code == 404
    assert client.get(f"/jobs/{job_id}/outputs/nope.txt", headers=auth(api_key)).status_code == 404
