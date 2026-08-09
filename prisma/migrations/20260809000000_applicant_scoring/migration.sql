-- Applicant scoring: a 0–20 score and reviewer notes, set before any decision.
--
-- These columns are what splits admissions into two passes. The scoring pass
-- fills them in over the whole queue; the decision pass reads them back in rank
-- order. NULL score means "not reviewed yet", which is exactly what the scoring
-- queue filters on — so the absence of a value is load-bearing and the column
-- has no default.
--
-- `scoredBy` mirrors `decidedBy`: written in the same UPDATE as the score it
-- attributes, so the two cannot drift, and ON DELETE SET NULL so removing an
-- organizer leaves the score standing with the attribution dropped rather than
-- taking the applicant's review down with it.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "notes" TEXT,
ADD COLUMN     "score" INTEGER,
ADD COLUMN     "scoredAt" TIMESTAMP(3),
ADD COLUMN     "scoredBy" TEXT;

-- CreateIndex
CREATE INDEX "User_score_idx" ON "User"("score");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_scoredBy_fkey" FOREIGN KEY ("scoredBy") REFERENCES "User"("uid") ON DELETE SET NULL ON UPDATE CASCADE;
