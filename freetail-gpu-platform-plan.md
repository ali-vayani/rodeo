# Freetail GPU job platform

## Goal

Build a service where hackathon teams submit containerized GPU batch jobs, monitor execution, and retrieve results. Start with trusted Freetail developers, one GPU machine, and one exclusive job per GPU.

The resume's 200 jobs, 10 simulated teams, and 98% success rate are illustrative. Measure actual results before replacing the mockup with completed-work claims.

## Scope and architecture

Use FastAPI for the API, Postgres for job records and the persistent queue, Docker for execution, and an S3-compatible object store for inputs and outputs. A worker on the GPU host claims and executes jobs. Start without Redis or Kubernetes.

```text
Client -> FastAPI -> Postgres job queue
                         ^
                         |
                    GPU worker -> Docker workload
                         |
                    Object storage
```

Support approved images and short workloads such as embedding batches, inference experiments, and small fine-tuning runs. Exclude interactive notebooks, multi-GPU jobs, arbitrary public containers, and preemption from the first version.

## Milestone 1: Prove the workload

- Ask a few Freetail developers which GPU workloads they would use.
- Choose two example jobs with predictable inputs and outputs.
- Run both manually inside containers on a GPU host.
- Record dependencies, GPU requirements, runtime, and output format.
- Set a GPU spending cap and shut down rented machines between sessions.

Completion check: both containers run successfully, and their outputs can be checked automatically.

## Milestone 2: Build the submission API

Implement these endpoints:

- `POST /jobs`
- `GET /jobs/{id}`
- `POST /jobs/{id}/cancel`
- `GET /jobs/{id}/logs`
- `GET /jobs/{id}/outputs`

A submission includes an approved image digest, command, input location, and maximum runtime. Authenticate teams with API keys and check ownership on every job endpoint. Store key hashes rather than plaintext keys.

Persist teams, jobs, execution attempts, and usage reservations. Accept a team-scoped idempotency key on submission so retries do not create duplicate jobs.

Use explicit states:

```text
QUEUED -> STARTING -> RUNNING -> SUCCEEDED
                         -> FAILED
                         -> TIMED_OUT
                         -> CANCELLED
```

Represent cancellation as a request until the worker confirms execution has stopped. Keep an uncertain execution distinguishable from a confirmed failure.

Completion checks:

- API restarts preserve queued jobs.
- Concurrent duplicate submissions create one logical job.
- Teams cannot read, cancel, or retrieve another team's jobs.
- Invalid images, deadlines, and input locations are rejected.

## Milestone 3: Execute jobs

Build a fake executor locally, then a Docker executor on the GPU host.

- Claim jobs transactionally so two workers cannot claim the same attempt.
- Reserve the GPU slot before launching the container.
- Label containers with job and attempt IDs.
- Mount a separate working directory for each attempt.
- Enforce CPU, RAM, and runtime limits.
- Capture stdout, stderr, exit status, and timestamps.
- Upload outputs under attempt-specific paths.
- Release capacity only after confirming execution has stopped.

Completion check: a client submits a real GPU job and retrieves its result without manual intervention on the host.

## Milestone 4: Schedule across teams

Start with FIFO. Add round-robin selection across teams and one active job per team. Keep scheduling and claiming atomic.

Reserve each job's maximum GPU runtime against its team's budget before starting it. Reconcile the reservation against actual runtime after completion. Initially bill exclusive GPU wall time, with documented treatment of setup and cleanup.

Completion checks:

- A team submitting 100 jobs cannot indefinitely block another team's first job.
- Simultaneous requests cannot overspend a team's budget.
- Queue cancellation releases reservations exactly once.
- A long running job blocks the GPU only until completion or its deadline.

## Milestone 5: Recover from failures

Add heartbeats, execution leases, and startup reconciliation. A missing heartbeat does not prove that a container stopped. Avoid retrying an uncertain attempt until the old execution has been reconciled or the host has been fenced off.

On worker restart, inspect labeled containers and reconnect monitoring before claiming new work. Use attempt IDs and conditional state updates so stale workers cannot overwrite newer state. Do not promise exactly-once external side effects for arbitrary workloads.

Inject these failures:

| Failure               | Required result                                             |
| --------------------- | ----------------------------------------------------------- |
| API restart           | Jobs remain recorded                                        |
| Container error       | Failure and logs are visible                                |
| Deadline exceeded     | Container stops and capacity returns                        |
| Running cancellation  | Execution stops before cancellation is finalized            |
| Worker restart        | Existing containers are reconciled                          |
| Host unreachable      | Execution remains uncertain until resolved                  |
| Output upload failure | Execution outcome and upload failure remain distinguishable |

Completion check: failures do not leak GPU slots, corrupt accounting, or silently create concurrent duplicate executions.

## Milestone 6: Benchmark

Run a fixed workload mix with short and long jobs across 10 simulated teams. Include an aggressive submitter. Compare FIFO and round-robin using the same job trace. A 200-job run is a useful experiment, not a promised result.

Record:

- Per-team p50 and p95 queue wait.
- Completed jobs per hour.
- GPU busy time and idle time while work is queued.
- Time between job completion and the next launch.
- Successes, workload errors, infrastructure errors, timeouts, and cancellations separately.
- Recovery time after worker failure.

Save the workload trace, hardware details, configuration, raw results, and plotting script. Explain the denominator of any success-rate claim.

Completion check: results show how scheduling changes wait time and throughput, including tradeoffs.

## Milestone 7: Trusted beta

Give a few Freetail developers access. Provide sample containers, a Python client, operating hours, and usage limits. Avoid exposing the Docker socket or host credentials to jobs. Treat containers as insufficient isolation for arbitrary untrusted public code. Broader access needs a separate isolation design.

Completion check: another developer can submit work, interpret failures, retrieve results, and deploy the service using the documentation.

## Suggested repository

```text
api/
scheduler/
worker/
client/
examples/
tests/
benchmarks/
```

## Build order and stopping point

Estimate 3 to 5 weeks part-time, depending on GPU access. Finish submission through result retrieval first, then scheduling, recovery, benchmarks, and beta use. Develop API and state-machine tests locally using the fake executor.

Stop when the trusted beta works and failure recovery is tested. Add autoscaling or multiple GPUs only when actual workloads justify them.

Final artifacts should include runnable code, a deployment guide, correctness tests, reproducible benchmarks, and a short write-up of one investigated failure and one measured improvement.
