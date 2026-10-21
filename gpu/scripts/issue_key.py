"""Issue an API key for a team until the Rodeo admin flow exists.

    python scripts/issue_key.py <teamId>
"""

import sys

from gpu.config import load_settings
from gpu.db import make_pool
from gpu.jobs.keys import issue_key

if len(sys.argv) != 2:
    sys.exit(__doc__)
settings = load_settings()
with make_pool(settings.database_url, max_size=1).connection() as conn:
    key = issue_key(conn, sys.argv[1])
print(f"team:   {key.team_id}")
print(f"prefix: {key.prefix}")
print(f"key:    {key.plaintext}")
print("Store the key now; only its hash is kept.")
