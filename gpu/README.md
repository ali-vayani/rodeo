# GPU job platform

Python service for submitting containerized GPU jobs. It shares Rodeo's Postgres: the
`ApiKey`, `Job`, and `JobAttempt` tables are defined in `prisma/schema.prisma` and
migrated by Prisma. This code reads and writes them and never migrates. See
`freetail-gpu-platform-plan.md` at the repo root for the full plan.

## Layout

```text
gpu/jobs/models.py    row snapshots and the JobState enum
gpu/jobs/queries.py   one function per transition, each a conditional UPDATE
gpu/jobs/keys.py      API key issue and lookup (hash only is stored)
gpu/api/              FastAPI: bearer-key auth dependency and the /jobs routes
gpu/worker/           claim, run, heartbeat, finish; executor interface; fake executor
scripts/issue_key.py  issue a key for a team until the Rodeo admin flow exists
tests/                run against a real Postgres with the migrations applied
```

The `Job` table is the queue. A worker claims the oldest `QUEUED` row with
`FOR UPDATE SKIP LOCKED` and flips it to `STARTING` in the same transaction. Every
later transition is one `UPDATE ... WHERE state = <expected>`, so a stale worker or a
late cancel changes zero rows instead of overwriting a newer state.

## Setup

```bash
cd gpu
python3.12 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
```

Environment:

| Variable                     | Purpose                                                          |
| ---------------------------- | ---------------------------------------------------------------- |
| `DATABASE_URL`               | Rodeo's Postgres, direct connection (not the transaction pooler) |
| `GPU_DATA_DIR`               | Local root for inputs, logs, and outputs. Default `.gpu-data`    |
| `GPU_ALLOWED_IMAGE_PREFIXES` | Comma-separated image prefixes a job may use. Empty rejects all  |
| `GPU_MAX_RUNTIME_SECONDS`    | Upper bound on a job's deadline. Default 3600                    |
| `GPU_WORKER_ID`              | Name recorded on attempts. Default `worker-<pid>`                |
| `GPU_POLL_SECONDS`           | Worker idle poll interval. Default 1                             |
| `GPU_HEARTBEAT_SECONDS`      | Heartbeat interval while a job runs. Default 5                   |

## Run

```bash
python scripts/issue_key.py <teamId>          # prints the key once
uvicorn gpu.api.main:create_app --factory     # API on :8000
python -m gpu.worker                          # worker with the fake executor
```

Submit a job:

```bash
curl -X POST localhost:8000/jobs \
  -H "Authorization: Bearer ftgpu_..." \
  -H "Idempotency-Key: first-try" \
  -d '{"image":"ghcr.io/freetail-hackers/embedder:v1","command":["sleep","5"],"max_runtime_seconds":60}'
```

Inputs are files under `$GPU_DATA_DIR/inputs/<teamId>/`, referenced by their relative
path in the `input` field. Logs and outputs land under `$GPU_DATA_DIR/jobs/<jobId>/<attemptId>/`
and are served by `/jobs/{id}/logs` and `/jobs/{id}/outputs`.

The fake executor reads the command as a script: `["sleep", "2"]`, `["fail", "2", "3"]`,
`["hang"]`, `["write", "name"]`. The Docker executor replaces it in the next milestone.

## Tests

The tests need a throwaway Postgres with the Prisma migrations applied:

```bash
docker run -d --rm --name gpu-test-db -e POSTGRES_USER=rodeo -e POSTGRES_PASSWORD=rodeo \
  -e POSTGRES_DB=rodeo -p 127.0.0.1:55432:5432 postgres:16-alpine
export TEST_DATABASE_URL=postgresql://rodeo:rodeo@127.0.0.1:55432/rodeo
(cd .. && DATABASE_URL=$TEST_DATABASE_URL npx prisma migrate deploy)
pytest
```

The tests delete rows from `Job`, `JobAttempt`, and `ApiKey`, so never point them at a
real database.
