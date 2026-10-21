-- GPU job platform, part one: storage shape. ApiKey is the per-team compute credential
-- (hash only). Job is the queue itself: workers claim QUEUED rows by flipping them to
-- STARTING in one transaction. JobAttempt holds per-run facts so a job re-run after a
-- worker crash keeps its history. See freetail-gpu-platform-plan.md.
-- CreateEnum
CREATE TYPE "JobState" AS ENUM ('QUEUED', 'STARTING', 'RUNNING', 'UNKNOWN', 'SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELLED');

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "command" TEXT[],
    "inputKey" TEXT,
    "maxRuntimeSeconds" INTEGER NOT NULL,
    "state" "JobState" NOT NULL DEFAULT 'QUEUED',
    "idempotencyKey" TEXT,
    "cancelRequestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentAttemptId" TEXT,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobAttempt" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "containerId" TEXT,
    "imageDigest" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastHeartbeatAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "exitCode" INTEGER,
    "errorKind" TEXT,

    CONSTRAINT "JobAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_teamId_idx" ON "ApiKey"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "Job_currentAttemptId_key" ON "Job"("currentAttemptId");

-- CreateIndex
CREATE INDEX "Job_state_createdAt_idx" ON "Job"("state", "createdAt");

-- CreateIndex
CREATE INDEX "Job_teamId_createdAt_idx" ON "Job"("teamId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Job_teamId_idempotencyKey_key" ON "Job"("teamId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "JobAttempt_jobId_startedAt_idx" ON "JobAttempt"("jobId", "startedAt");

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_currentAttemptId_fkey" FOREIGN KEY ("currentAttemptId") REFERENCES "JobAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobAttempt" ADD CONSTRAINT "JobAttempt_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

