-- Blacklist: replace the discriminated (type, value) pair with explicit name and email
-- columns.
--
-- The two signals no longer carry equal weight -- an email match auto-rejects at submit
-- while a name match only flags the applicant for a reviewer -- so they need to live in
-- separate columns rather than being told apart by an enum tag at read time.
--
-- Written as add-backfill-drop rather than the straight column swap `prisma migrate diff`
-- emits, because that version fails outright on any table that already has rows: you
-- cannot ADD COLUMN ... NOT NULL without a default onto a non-empty table.
--
-- IF NOT EXISTS / IF EXISTS guards added so this migration is safe to apply regardless
-- of whether the preceding blacklist migration already dropped type/value or not.

-- 1. Add nullable so existing rows survive until the backfill fills them in.
ALTER TABLE "Blacklist"
  ADD COLUMN IF NOT EXISTS "firstName" TEXT,
  ADD COLUMN IF NOT EXISTS "lastName"  TEXT,
  ADD COLUMN IF NOT EXISTS "email"     TEXT,
  ADD COLUMN IF NOT EXISTS "reason"    TEXT;

-- 2. Backfill from old columns — only runs if type/value still exist.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Blacklist' AND column_name = 'type'
  ) THEN
    -- EMAIL rows carry an address and no name; NAME rows the reverse.
    -- NULLIF collapses a blank address to NULL so blanks don't collide under the
    -- unique index added in step 7 (Postgres allows many NULLs, but only one '').
    UPDATE "Blacklist"
    SET "email"     = NULLIF(lower(btrim("value")), ''),
        "firstName" = '',
        "lastName"  = ''
    WHERE "type" = 'EMAIL';

    -- Split on the first and last whitespace-delimited token, mirroring how the
    -- application splits an applicant's single User.name at match time.
    UPDATE "Blacklist"
    SET "firstName" = split_part(btrim("value"), ' ', 1),
        "lastName"  = CASE
                        WHEN btrim("value") LIKE '% %' THEN regexp_replace(btrim("value"), '^.*\s+', '')
                        ELSE ''
                      END
    WHERE "type" = 'NAME';
  END IF;
END
$$;

-- 3. Anything the backfill missed degrades to inert instead of failing step 4.
UPDATE "Blacklist"
SET "firstName" = COALESCE("firstName", ''),
    "lastName"  = COALESCE("lastName", '');

-- 4. Now that every row is populated, enforce the constraint.
ALTER TABLE "Blacklist"
  ALTER COLUMN "firstName" SET NOT NULL,
  ALTER COLUMN "lastName"  SET NOT NULL;

-- 5. The old table had no uniqueness on value, so duplicate addresses are possible and
--    would break step 7. Keep the oldest row per address; the id tie-breaks rows sharing
--    a createdAt, without which an exact tie would leave both rows in place.
DELETE FROM "Blacklist" a
USING "Blacklist" b
WHERE a."email" IS NOT NULL
  AND a."email" = b."email"
  AND (a."createdAt", a."id") > (b."createdAt", b."id");

-- 6. Retire the old representation only if it still exists.
ALTER TABLE "Blacklist" DROP COLUMN IF EXISTS "type";
ALTER TABLE "Blacklist" DROP COLUMN IF EXISTS "value";

DROP TYPE IF EXISTS "BlacklistType";

-- 7. Indexes.
CREATE UNIQUE INDEX IF NOT EXISTS "Blacklist_email_key" ON "Blacklist"("email");
CREATE INDEX IF NOT EXISTS "Blacklist_createdAt_idx" ON "Blacklist"("createdAt");
