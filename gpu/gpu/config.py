"""Environment-driven settings shared by the API and the worker."""

import os
from dataclasses import dataclass
from pathlib import Path


def _csv(value: str) -> tuple[str, ...]:
    return tuple(part.strip() for part in value.split(",") if part.strip())


@dataclass(frozen=True)
class Settings:
    database_url: str
    # Local storage root for inputs, logs, and outputs until object storage lands.
    data_dir: Path
    # Image references must start with one of these; empty means nothing is allowed.
    allowed_image_prefixes: tuple[str, ...]
    max_runtime_seconds: int
    worker_id: str
    poll_seconds: float
    heartbeat_seconds: float


def load_settings() -> Settings:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is not set")
    return Settings(
        database_url=database_url,
        data_dir=Path(os.environ.get("GPU_DATA_DIR", ".gpu-data")).resolve(),
        allowed_image_prefixes=_csv(os.environ.get("GPU_ALLOWED_IMAGE_PREFIXES", "")),
        max_runtime_seconds=int(os.environ.get("GPU_MAX_RUNTIME_SECONDS", "3600")),
        worker_id=os.environ.get("GPU_WORKER_ID", f"worker-{os.getpid()}"),
        poll_seconds=float(os.environ.get("GPU_POLL_SECONDS", "1")),
        heartbeat_seconds=float(os.environ.get("GPU_HEARTBEAT_SECONDS", "5")),
    )
