-- Decision attribution: who last set each applicant's decision.
--
-- Deliberately a column on `User` rather than an incrementing counter table.
-- The stats page asks "how many applicants currently sit at ACCEPTED because
-- of admin X" — a question about present state, not about history. Keeping the
-- answer on the same row as the decision, written by the same UPDATE, means
-- reattributing an applicant moves them between GROUP BY buckets with no
-- decrement to compute and nothing that can drift out of sync.
--
-- Not backfilled. `admissions.release` logs one aggregate row with no per-user
-- target, so any reconstruction from `Log` would be partial; NULL reads
-- honestly as "Unattributed" instead of silently wrong.
--
-- The two Scan indexes below are NOT part of this feature. They are declared in
-- schema.prisma at HEAD but no migration ever created them — pre-existing drift
-- that this, the first migration since, reconciles.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "decidedAt" TIMESTAMP(3),
ADD COLUMN     "decidedBy" TEXT;

-- CreateIndex
CREATE INDEX "Scan_userId_action_timestamp_idx" ON "Scan"("userId", "action", "timestamp");

-- CreateIndex
CREATE INDEX "Scan_timestamp_idx" ON "Scan"("timestamp");

-- CreateIndex
CREATE INDEX "User_decidedBy_decidedAt_idx" ON "User"("decidedBy", "decidedAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_decidedBy_fkey" FOREIGN KEY ("decidedBy") REFERENCES "User"("uid") ON DELETE SET NULL ON UPDATE CASCADE;
