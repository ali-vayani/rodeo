"""An executor that runs nothing. It reads the job's command as a script so tests can
drive every transition without a container runtime:

    ["sleep", "2"]        succeed after 2 seconds
    ["fail", "2", "3"]    exit with code 3 after 2 seconds
    ["hang"]              run until killed (deadline or cancel)
    ["write", "name"]     write an output file called `name`, then succeed

Anything else succeeds immediately."""

import threading
import time

from gpu.jobs.models import Job, JobAttempt
from gpu.worker.executor import AttemptPaths, ExitStatus


class FakeExecution:
    def __init__(self, job: Job, paths: AttemptPaths):
        self._paths = paths
        self._status: ExitStatus | None = None
        self._killed = threading.Event()
        self._thread = threading.Thread(target=self._run, args=(job.command,), daemon=True)
        self._thread.start()

    container_id = None
    image_digest = None

    def _log(self, line: str) -> None:
        with self._paths.log.open("a") as f:
            f.write(line + "\n")

    def _run(self, command: list[str]) -> None:
        verb = command[0] if command else "noop"
        self._log(f"fake executor: {command}")
        if verb == "hang":
            self._killed.wait()
            self._status = ExitStatus(exit_code=137, error_kind="workload")
            return
        delay = float(command[1]) if len(command) > 1 and verb in {"sleep", "fail"} else 0
        if self._killed.wait(delay):
            self._status = ExitStatus(exit_code=137, error_kind="workload")
            return
        if verb == "fail":
            code = int(command[2]) if len(command) > 2 else 1
            self._log(f"failing with {code}")
            self._status = ExitStatus(exit_code=code, error_kind="workload")
            return
        if verb == "write":
            (self._paths.outputs / command[1]).write_text("hello from the fake executor\n")
        self._log("done")
        self._status = ExitStatus(exit_code=0)

    def poll(self) -> ExitStatus | None:
        return self._status

    def kill(self) -> None:
        self._killed.set()


class FakeExecutor:
    def start(self, job: Job, attempt: JobAttempt, paths: AttemptPaths) -> FakeExecution:
        return FakeExecution(job, paths)
