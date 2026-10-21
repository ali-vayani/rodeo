"""Tests run against a real Postgres with the Prisma migrations applied. Point
TEST_DATABASE_URL at a throwaway database; see gpu/README.md."""

import os

import pytest
from fastapi.testclient import TestClient

from gpu.api.main import create_app
from gpu.config import Settings
from gpu.db import make_pool
from gpu.ids import new_id
from gpu.jobs.keys import issue_key

ALLOWED_PREFIX = "ghcr.io/freetail-hackers/"


@pytest.fixture(scope="session")
def database_url() -> str:
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL not set")
    return url


@pytest.fixture(scope="session")
def pool(database_url):
    pool = make_pool(database_url, max_size=16)
    yield pool
    pool.close()


@pytest.fixture
def settings(database_url, tmp_path) -> Settings:
    return Settings(
        database_url=database_url,
        data_dir=tmp_path / "data",
        allowed_image_prefixes=(ALLOWED_PREFIX,),
        max_runtime_seconds=60,
        worker_id="test-worker",
        poll_seconds=0.05,
        heartbeat_seconds=0.1,
    )


@pytest.fixture(autouse=True)
def clean_db(pool):
    with pool.connection() as conn:
        conn.execute('DELETE FROM "JobAttempt"')
        conn.execute('DELETE FROM "Job"')
        conn.execute('DELETE FROM "ApiKey"')
        conn.execute('DELETE FROM "Team" WHERE "teamName" LIKE %s', ("gpu-test-%",))
    yield


def make_team(pool, name: str) -> str:
    team_id = new_id()
    with pool.connection() as conn:
        conn.execute(
            'INSERT INTO "Team" ("id", "teamName", "inviteCode") VALUES (%s, %s, %s)',
            (team_id, f"gpu-test-{name}", new_id()),
        )
    return team_id


@pytest.fixture
def team(pool) -> str:
    return make_team(pool, "a")


@pytest.fixture
def other_team(pool) -> str:
    return make_team(pool, "b")


@pytest.fixture
def api_key(pool, team) -> str:
    with pool.connection() as conn:
        return issue_key(conn, team).plaintext


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings)) as client:
        yield client


def auth(key: str) -> dict:
    return {"Authorization": f"Bearer {key}"}


def job_body(**overrides) -> dict:
    body = {
        "image": ALLOWED_PREFIX + "embedder:v1",
        "command": ["sleep", "0"],
        "max_runtime_seconds": 10,
    }
    body.update(overrides)
    return body
