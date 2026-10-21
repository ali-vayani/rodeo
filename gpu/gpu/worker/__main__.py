"""`python -m gpu.worker` runs the loop with the fake executor until a real one exists."""

import logging

from gpu.config import load_settings
from gpu.db import make_pool
from gpu.worker.fake import FakeExecutor
from gpu.worker.loop import run_forever

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
settings = load_settings()
run_forever(make_pool(settings.database_url, max_size=2), settings, FakeExecutor())
