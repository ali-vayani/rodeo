-- `User.roles Role[]` collapses to `User.role Role`, making roles mutually exclusive.
--
-- The array permitted combinations the app had no coherent answer for — an account
-- that was both ADMIN and HACKER belonged to both portals at once — so every guard
-- grew its own precedence rule and they did not all agree. One column, one role.
--
-- Backfill picks the *strongest* role held, using the same ranking the app already
-- sorted by (ADMIN > ORGANIZER > JUDGE > MENTOR > VOLUNTEER > HACKER > UNDECLARED).
-- Strongest rather than first-in-array because the array had no meaningful order and
-- demoting an admin to HACKER would lock them out of the portal, while the reverse
-- error is visible immediately and fixable from /admin/users. An empty array — which
-- the old default made reachable — lands on UNDECLARED.

ALTER TABLE "User" ADD COLUMN "role" "Role";

UPDATE "User" SET "role" = CASE
    WHEN 'ADMIN'      = ANY("roles") THEN 'ADMIN'::"Role"
    WHEN 'ORGANIZER'  = ANY("roles") THEN 'ORGANIZER'::"Role"
    WHEN 'JUDGE'      = ANY("roles") THEN 'JUDGE'::"Role"
    WHEN 'MENTOR'     = ANY("roles") THEN 'MENTOR'::"Role"
    WHEN 'VOLUNTEER'  = ANY("roles") THEN 'VOLUNTEER'::"Role"
    WHEN 'HACKER'     = ANY("roles") THEN 'HACKER'::"Role"
    ELSE 'UNDECLARED'::"Role"
END;

-- Only now that every row has a value: adding the column NOT NULL up front would
-- need a default, and a default here would silently paper over a failed backfill.
ALTER TABLE "User" ALTER COLUMN "role" SET NOT NULL;
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'UNDECLARED';

ALTER TABLE "User" DROP COLUMN "roles";
