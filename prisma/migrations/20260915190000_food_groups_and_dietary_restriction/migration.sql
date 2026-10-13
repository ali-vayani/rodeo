-- Squashed migration for this branch's food-group feature: what used to be four
-- migrations (lunch_groups -> lunch_group_release -> dietary_restriction_on_user ->
-- rename_lunch_group_to_food_group) collapsed into one, written with the feature's
-- final names throughout rather than replaying the lunch -> food rename. None of these
-- four are shared with `mainline`, so replacing them here doesn't affect other branches.

-- Dietary restrictions live in application responses; food-group assignments are
-- separate so an admin can regenerate or edit them without changing a user's profile.
ALTER TYPE "LinkedField" ADD VALUE 'DIETARY_RESTRICTION';

-- CreateEnum
CREATE TYPE "FoodGroupPool" AS ENUM ('DIETARY_RESTRICTION', 'NO_RESTRICTION');

-- CreateTable
CREATE TABLE "FoodGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pool" "FoodGroupPool" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Null until an admin explicitly makes this group's assignments visible to attendees.
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "FoodGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoodGroupMember" (
    "id" TEXT NOT NULL,
    "foodGroupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "FoodGroupMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FoodGroupMember_userId_key" ON "FoodGroupMember"("userId");
CREATE UNIQUE INDEX "FoodGroupMember_foodGroupId_userId_key" ON "FoodGroupMember"("foodGroupId", "userId");

ALTER TABLE "FoodGroupMember" ADD CONSTRAINT "FoodGroupMember_foodGroupId_fkey"
  FOREIGN KEY ("foodGroupId") REFERENCES "FoodGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FoodGroupMember" ADD CONSTRAINT "FoodGroupMember_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("uid") ON DELETE CASCADE ON UPDATE CASCADE;

-- Dietary restriction mirrors onto `User`, like every other linked field, so food
-- grouping reads a plain column instead of re-deriving pools from the answers table on
-- every generate. Unlike NAME/UNIVERSITY/YEAR it lands in an array column, since the
-- question is MULTI_SELECT and a person may hold several restrictions.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "dietaryRestriction" TEXT[] NOT NULL DEFAULT '{}';

-- Backfill from each user's existing dietary-restriction answer, if any.
--
-- The answer is stored as `ApplicationResponse.value`: a JSON array of the selected
-- option strings (see `$lib/questions/multiSelect`), or '' for no answer. The app's own
-- decoder (`decodeMultiSelect`) is tolerant of anything else — a pre-MULTI_SELECT single
-- value, or a hand-edited row — and renders it as an empty selection rather than
-- throwing. This backfill mirrors that tolerance with a per-row exception handler, so
-- one malformed historical row can't abort the whole migration; it falls back to '{}'
-- for that row exactly as the app would.
--
-- 'No dietary restrictions' is an offered option, not an actual restriction, so it is
-- dropped here too — see `NO_DIETARY_RESTRICTION_OPTION` in `$lib/dietaryRestriction`,
-- which excludes it going forward. Matched by exact text.
--
-- The WHERE clause casts the enum column to text (`q."linkedField"::text`) rather than
-- comparing directly against the enum, because comparing a literal against the enum
-- type would try to use the 'DIETARY_RESTRICTION' value added above in the same
-- transaction — Postgres rejects that ("unsafe use of new value of enum type") until
-- the addition is committed. Casting the column to text instead avoids constructing a
-- new enum literal here at all, so it works in the same transaction as the ADD VALUE
-- above; verified directly against Postgres before relying on it.
DO $$
DECLARE
  r RECORD;
  parsed JSONB;
  values_arr TEXT[];
BEGIN
  FOR r IN
    SELECT ar."userId" AS uid, ar.value
    FROM "ApplicationResponse" ar
    JOIN "Question" q ON q.id = ar."questionId"
    WHERE q."linkedField"::text = 'DIETARY_RESTRICTION'
  LOOP
    values_arr := '{}';
    IF r.value IS NOT NULL AND r.value <> '' THEN
      BEGIN
        parsed := r.value::jsonb;
        IF jsonb_typeof(parsed) = 'array' THEN
          SELECT COALESCE(array_agg(elem), '{}') INTO values_arr
          FROM jsonb_array_elements_text(parsed) AS elem
          WHERE elem <> 'No dietary restrictions';
        END IF;
      EXCEPTION WHEN OTHERS THEN
        values_arr := '{}';
      END;
    END IF;
    UPDATE "User" SET "dietaryRestriction" = values_arr WHERE uid = r.uid;
  END LOOP;
END $$;
