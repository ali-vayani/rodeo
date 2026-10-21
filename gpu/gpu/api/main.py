"""Submission API. Routes validate, call one query, and shape the response."""

import re
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, Header, HTTPException, Request, Response, status
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel, Field

from gpu import storage
from gpu.api.auth import TeamId
from gpu.config import Settings, load_settings
from gpu.db import make_pool
from gpu.jobs import queries
from gpu.jobs.models import Job, JobSpec, JobState

# registry/repo[:tag][@sha256:hex]; no uppercase, no whitespace, no shell metacharacters.
_IMAGE_RE = re.compile(
    r"^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?(?:/[a-z0-9]+(?:[._-][a-z0-9]+)*)*"
    r"(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?(?:@sha256:[a-f0-9]{64})?$"
)
_COMMAND_MAX_BYTES = 4096


class JobRequest(BaseModel):
    image: str = Field(min_length=1, max_length=512)
    command: list[str] = Field(default_factory=list)
    input: str | None = None
    max_runtime_seconds: int = Field(ge=1)


class JobResponse(BaseModel):
    id: str
    state: JobState
    image: str
    command: list[str]
    input: str | None
    max_runtime_seconds: int
    created_at: datetime
    cancel_requested_at: datetime | None
    current_attempt_id: str | None

    @classmethod
    def from_job(cls, job: Job) -> "JobResponse":
        return cls(
            id=job.id,
            state=job.state,
            image=job.image,
            command=job.command,
            input=job.input_key,
            max_runtime_seconds=job.max_runtime_seconds,
            created_at=job.created_at,
            cancel_requested_at=job.cancel_requested_at,
            current_attempt_id=job.current_attempt_id,
        )


class OutputFile(BaseModel):
    path: str
    size: int


def validate_spec(settings: Settings, team_id: str, body: JobRequest) -> JobSpec:
    if not _IMAGE_RE.match(body.image):
        raise HTTPException(422, "malformed image reference")
    if not any(body.image.startswith(p) for p in settings.allowed_image_prefixes):
        raise HTTPException(422, "image is not on the allowlist")
    if sum(len(part.encode()) for part in body.command) > _COMMAND_MAX_BYTES:
        raise HTTPException(422, "command too long")
    if any(part == "" for part in body.command):
        raise HTTPException(422, "empty command argument")
    if body.max_runtime_seconds > settings.max_runtime_seconds:
        raise HTTPException(
            422,
            f"max_runtime_seconds exceeds the limit of {settings.max_runtime_seconds}",
        )
    if body.input is not None:
        if not storage.valid_input_key(body.input):
            raise HTTPException(422, "malformed input key")
        if not storage.input_path(settings.data_dir, team_id, body.input).is_file():
            raise HTTPException(422, "input not found")
    return JobSpec(
        image=body.image,
        command=body.command,
        input_key=body.input,
        max_runtime_seconds=body.max_runtime_seconds,
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.settings = settings
        app.state.pool = make_pool(settings.database_url)
        try:
            yield
        finally:
            app.state.pool.close()

    app = FastAPI(title="Rodeo GPU jobs", lifespan=lifespan)

    def pool(request: Request):
        return request.app.state.pool

    def job_or_404(conn, team_id: str, job_id: str) -> Job:
        job = queries.get_job(conn, team_id, job_id)
        if job is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "job not found")
        return job

    @app.post("/jobs", response_model=JobResponse)
    def submit_job(
        request: Request,
        response: Response,
        team_id: TeamId,
        body: JobRequest,
        idempotency_key: Annotated[str | None, Header(max_length=128)] = None,
    ):
        spec = validate_spec(settings, team_id, body)
        with pool(request).connection() as conn:
            job, created = queries.create_job(conn, team_id, spec, idempotency_key)
        response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
        return JobResponse.from_job(job)

    @app.get("/jobs", response_model=list[JobResponse])
    def list_jobs(request: Request, team_id: TeamId):
        with pool(request).connection() as conn:
            return [JobResponse.from_job(j) for j in queries.list_jobs(conn, team_id)]

    @app.get("/jobs/{job_id}", response_model=JobResponse)
    def get_job(request: Request, team_id: TeamId, job_id: str):
        with pool(request).connection() as conn:
            return JobResponse.from_job(job_or_404(conn, team_id, job_id))

    @app.post("/jobs/{job_id}/cancel", response_model=JobResponse)
    def cancel_job(request: Request, team_id: TeamId, job_id: str):
        with pool(request).connection() as conn:
            result = queries.request_cancel(conn, team_id, job_id)
            if result is queries.CancelResult.NOT_FOUND:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "job not found")
            if result is queries.CancelResult.TERMINAL:
                raise HTTPException(status.HTTP_409_CONFLICT, "job already finished")
            return JobResponse.from_job(job_or_404(conn, team_id, job_id))

    def attempt_paths(request: Request, team_id: str, job_id: str) -> tuple[Job, Path]:
        with pool(request).connection() as conn:
            job = job_or_404(conn, team_id, job_id)
        if job.current_attempt_id is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "job has not started")
        return job, storage.attempt_dir(settings.data_dir, job.id, job.current_attempt_id)

    @app.get("/jobs/{job_id}/logs", response_class=PlainTextResponse)
    def get_logs(request: Request, team_id: TeamId, job_id: str):
        job, _ = attempt_paths(request, team_id, job_id)
        path = storage.log_path(settings.data_dir, job.id, job.current_attempt_id)
        if not path.is_file():
            return ""
        return path.read_text(errors="replace")

    @app.get("/jobs/{job_id}/outputs", response_model=list[OutputFile])
    def list_outputs(request: Request, team_id: TeamId, job_id: str):
        job, _ = attempt_paths(request, team_id, job_id)
        root = storage.outputs_dir(settings.data_dir, job.id, job.current_attempt_id)
        if not root.is_dir():
            return []
        return [
            OutputFile(path=str(p.relative_to(root)), size=p.stat().st_size)
            for p in sorted(root.rglob("*"))
            if p.is_file()
        ]

    @app.get("/jobs/{job_id}/outputs/{rel_path:path}")
    def download_output(request: Request, team_id: TeamId, job_id: str, rel_path: str):
        job, _ = attempt_paths(request, team_id, job_id)
        path = storage.resolve_output(settings.data_dir, job.id, job.current_attempt_id, rel_path)
        if path is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "output not found")
        return FileResponse(path, filename=path.name)

    return app
