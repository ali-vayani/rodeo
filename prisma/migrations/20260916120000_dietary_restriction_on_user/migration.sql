-- Dietary restriction now mirrors onto `User`, like every other linked field, so
-- lunch grouping reads a plain column instead of re-deriving pools from the answers
-- table on every generate. Unlike NAME/UNIVERSITY/YEAR it lands in an array column,
-- since the question is MULTI_SELECT and a person may hold several restrictions.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "dietaryRestriction" TEXT[] NOT NULL DEFAULT '{}';

-- Backfill from each user's existing dietary-restriction answer, if any.
--
-- The answer is stored as `ApplicationResponse.value`: a JSON array of the selected
-- option strings (see `$lib/questions/multiSelect`), or '' for no answer. The app's
-- own decoder (`decodeMultiSelect`) is tolerant of anything else — a pre-MULTI_SELECT
-- single value, or a hand-edited row — and renders it as an empty selection rather
-- than throwing. This backfill mirrors that tolerance with a per-row exception
-- handler, so one malformed historical row can't abort the whole migration; it falls
-- back to '{}' for that row exactly as the app would.
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
    WHERE q."linkedField" = 'DIETARY_RESTRICTION'
  LOOP
    values_arr := '{}';
    IF r.value IS NOT NULL AND r.value <> '' THEN
      BEGIN
        parsed := r.value::jsonb;
        IF jsonb_typeof(parsed) = 'array' THEN
          SELECT COALESCE(array_agg(elem), '{}') INTO values_arr
          FROM jsonb_array_elements_text(parsed) AS elem;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        values_arr := '{}';
      END;
    END IF;
    UPDATE "User" SET "dietaryRestriction" = values_arr WHERE uid = r.uid;
  END LOOP;
END $$;
