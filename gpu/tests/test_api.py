from tests.conftest import ALLOWED_PREFIX, auth, job_body


def test_requires_valid_key(client, api_key):
    assert client.get("/jobs").status_code == 401
    assert client.get("/jobs", headers=auth("ftgpu_nope")).status_code == 401
    assert client.get("/jobs", headers=auth(api_key)).status_code == 200


def test_submit_and_fetch(client, api_key):
    r = client.post("/jobs", json=job_body(), headers=auth(api_key))
    assert r.status_code == 201, r.text
    job = r.json()
    assert job["state"] == "QUEUED"
    assert job["command"] == ["sleep", "0"]
    assert client.get(f"/jobs/{job['id']}", headers=auth(api_key)).json() == job
    assert [j["id"] for j in client.get("/jobs", headers=auth(api_key)).json()] == [job["id"]]


def test_idempotent_resubmit_returns_existing_job(client, api_key):
    headers = {**auth(api_key), "Idempotency-Key": "abc"}
    first = client.post("/jobs", json=job_body(), headers=headers)
    second = client.post("/jobs", json=job_body(), headers=headers)
    assert first.status_code == 201 and second.status_code == 200
    assert first.json()["id"] == second.json()["id"]


def test_rejects_bad_submissions(client, api_key, settings, team):
    def post(**overrides):
        return client.post("/jobs", json=job_body(**overrides), headers=auth(api_key))

    assert post(image="docker.io/library/ubuntu:latest").status_code == 422  # not allowlisted
    assert post(image=ALLOWED_PREFIX + "bad image").status_code == 422  # malformed
    assert post(image=ALLOWED_PREFIX + "x;rm -rf /").status_code == 422
    assert post(max_runtime_seconds=0).status_code == 422
    assert post(max_runtime_seconds=settings.max_runtime_seconds + 1).status_code == 422
    assert post(command=["echo", ""]).status_code == 422
    assert post(command=["x" * 5000]).status_code == 422
    assert post(input="../secret").status_code == 422
    assert post(input="missing.tar").status_code == 422  # key format fine, no such file

    data = settings.data_dir / "inputs" / team
    data.mkdir(parents=True)
    (data / "docs.tar").write_bytes(b"x")
    assert post(input="docs.tar").status_code == 201

    digest = ALLOWED_PREFIX + "embedder@sha256:" + "a" * 64
    assert post(image=digest).status_code == 201


def test_jobs_are_invisible_to_other_teams(client, api_key, pool, other_team):
    from gpu.jobs.keys import issue_key

    job_id = client.post("/jobs", json=job_body(), headers=auth(api_key)).json()["id"]
    with pool.connection() as conn:
        other_key = issue_key(conn, other_team).plaintext
    assert client.get(f"/jobs/{job_id}", headers=auth(other_key)).status_code == 404
    assert client.post(f"/jobs/{job_id}/cancel", headers=auth(other_key)).status_code == 404
    assert client.get(f"/jobs/{job_id}/logs", headers=auth(other_key)).status_code == 404
    assert client.get("/jobs", headers=auth(other_key)).json() == []


def test_cancel_queued_then_conflict(client, api_key):
    job_id = client.post("/jobs", json=job_body(), headers=auth(api_key)).json()["id"]
    r = client.post(f"/jobs/{job_id}/cancel", headers=auth(api_key))
    assert r.status_code == 200 and r.json()["state"] == "CANCELLED"
    assert client.post(f"/jobs/{job_id}/cancel", headers=auth(api_key)).status_code == 409
    assert client.post("/jobs/nope/cancel", headers=auth(api_key)).status_code == 404


def test_logs_and_outputs_before_start(client, api_key):
    job_id = client.post("/jobs", json=job_body(), headers=auth(api_key)).json()["id"]
    assert client.get(f"/jobs/{job_id}/logs", headers=auth(api_key)).status_code == 404
    assert client.get(f"/jobs/{job_id}/outputs", headers=auth(api_key)).status_code == 404
