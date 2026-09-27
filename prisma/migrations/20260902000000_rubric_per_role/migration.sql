-- Each applicant role gets its own rubric; a criterion belongs to exactly one.
-- Existing criteria describe the hacker application, so they become the hacker rubric.
ALTER TABLE "RubricCriterion" ADD COLUMN "role" "Role" NOT NULL DEFAULT 'HACKER';
ALTER TABLE "RubricCriterion" ALTER COLUMN "role" DROP DEFAULT;

CREATE INDEX "RubricCriterion_role_idx" ON "RubricCriterion"("role");
