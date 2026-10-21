"""Local filesystem layout for inputs, logs, and outputs. The worker and the API share
one host in this version, so paths are the handoff. Object storage replaces this later;
the layout mirrors the keys that will be used there.

    <data_dir>/inputs/<teamId>/<inputKey>
    <data_dir>/jobs/<jobId>/<attemptId>/log.txt
    <data_dir>/jobs/<jobId>/<attemptId>/out/
"""

import re
from pathlib import Path

_KEY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]*$")


def valid_input_key(key: str) -> bool:
    return bool(_KEY_RE.match(key)) and ".." not in key.split("/") and len(key) <= 512


def input_path(data_dir: Path, team_id: str, key: str) -> Path:
    return data_dir / "inputs" / team_id / key


def attempt_dir(data_dir: Path, job_id: str, attempt_id: str) -> Path:
    return data_dir / "jobs" / job_id / attempt_id


def log_path(data_dir: Path, job_id: str, attempt_id: str) -> Path:
    return attempt_dir(data_dir, job_id, attempt_id) / "log.txt"


def outputs_dir(data_dir: Path, job_id: str, attempt_id: str) -> Path:
    return attempt_dir(data_dir, job_id, attempt_id) / "out"


def resolve_output(data_dir: Path, job_id: str, attempt_id: str, rel: str) -> Path | None:
    """Resolve a client-supplied relative path inside the outputs dir, or None if it
    escapes it or does not exist."""
    root = outputs_dir(data_dir, job_id, attempt_id).resolve()
    candidate = (root / rel).resolve()
    if root != candidate and root not in candidate.parents:
        return None
    return candidate if candidate.is_file() else None
