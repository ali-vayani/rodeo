-- Safe version: drop the old type/value representation only if it still exists.
--
-- This migration was originally written assuming the init migration had already
-- created the Blacklist table with `type` (BlacklistType enum) and `value` columns.
-- The init migration was subsequently edited after being applied to production, so
-- production's Blacklist table may not have those columns. Using IF EXISTS makes
-- this migration a no-op in that case.
--
-- The email/name/reason columns are not added here — the subsequent
-- blacklist_split_name_and_email migration does that properly with a backfill
-- that handles non-empty tables and splits the single name into firstName/lastName.

ALTER TABLE "Blacklist" DROP COLUMN IF EXISTS "type";
ALTER TABLE "Blacklist" DROP COLUMN IF EXISTS "value";

DROP TYPE IF EXISTS "BlacklistType";
