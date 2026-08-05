-- Log grows from `{action, userId}` into a full audit record.
--
-- The old `action` column held a human sentence ("Released decisions for 12
-- users"); the new one holds a machine slug and `summary` holds the sentence.
-- Existing rows are therefore moved wholesale into `summary` and stamped with
-- the `legacy` slug rather than guessed at — a wrong slug would quietly
-- mis-filter history on the logs page, and there are only ever a handful of
-- these rows (createLog had two call sites).

-- Rename the actor FK before adding the snapshot columns beside it. Renaming a
-- column leaves the constraint's own name behind, and Prisma derives that name
-- from the column, so it has to be renamed explicitly or the next introspection
-- reports drift.
ALTER TABLE "Log" RENAME COLUMN "userId" TO "actorId";
ALTER TABLE "Log" RENAME CONSTRAINT "Log_userId_fkey" TO "Log_actorId_fkey";

ALTER TABLE "Log"
    ADD COLUMN "summary"     TEXT,
    ADD COLUMN "actorName"   TEXT,
    ADD COLUMN "actorEmail"  TEXT,
    ADD COLUMN "targetId"    TEXT,
    ADD COLUMN "targetLabel" TEXT,
    ADD COLUMN "metadata"    JSONB;

-- Carry the old sentence across, then reclassify the slug.
UPDATE "Log" SET "summary" = "action";
UPDATE "Log" SET "action" = 'legacy';

-- Snapshot the actor names for rows that still have a live actor, so history
-- written before this migration survives that user being deleted too.
UPDATE "Log" l
   SET "actorName"  = u."name",
       "actorEmail" = u."email"
  FROM "User" u
 WHERE l."actorId" = u."uid";

-- Only safe to enforce once every row has been backfilled above.
ALTER TABLE "Log" ALTER COLUMN "summary" SET NOT NULL;

DROP INDEX IF EXISTS "Log_userId_idx";
CREATE INDEX "Log_timestamp_idx" ON "Log"("timestamp");
CREATE INDEX "Log_actorId_timestamp_idx" ON "Log"("actorId", "timestamp");
CREATE INDEX "Log_action_timestamp_idx" ON "Log"("action", "timestamp");
