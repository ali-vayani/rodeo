"""The seam between the worker loop and whatever runs the job. The loop only needs to
start an execution, poll it, and kill it. Docker on a GPU host implements the same
three calls later."""

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from gpu.jobs.models import Job, JobAttempt


@dataclass(frozen=True)
class AttemptPaths:
    input: Path | None  # read-only data for the job, mounted at /in
    log: Path  # stdout and stderr, appended as the job runs
    outputs: Path  # whatever the job leaves here is what the client can fetch


@dataclass(frozen=True)
class ExitStatus:
    exit_code: int
    # "workload" when the job's own process failed, "infrastructure" when we could not
    # run it properly (image pull, mount, runtime error). None on success.
    error_kind: str | None = None


class Execution(Protocol):
    @property
    def container_id(self) -> str | None: ...

    @property
    def image_digest(self) -> str | None: ...

    def poll(self) -> ExitStatus | None:
        """Non-blocking. None while still running."""
        ...

    def kill(self) -> None:
        """Stop the execution. Must be safe to call more than once."""
        ...


class Executor(Protocol):
    def start(self, job: Job, attempt: JobAttempt, paths: AttemptPaths) -> Execution: ...
