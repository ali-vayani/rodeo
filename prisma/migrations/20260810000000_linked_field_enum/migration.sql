-- Linked fields become an enum, and questions gain a preset option list.
--
-- `Question.linkedField` was TEXT holding one of three lowercase strings. Its value
-- is used as a computed property key into a Prisma `update` on `User`, so a typo
-- produced a question that saved fine and wrote nowhere — nothing rejected it on the
-- way in, and the allowlist was only consulted at read time. The enum moves that
-- check to the database, and Zod's `nativeEnum` inherits it for free.
--
-- The type change is written by hand rather than as Prisma's generated
-- drop-and-recreate, which would discard every existing link. The USING clause
-- upper-cases the stored values in place; anything unrecognised becomes NULL, which
-- is the honest reading of a value that was never a valid linked field.
--
-- `optionPreset` names a bundled list a question draws its choices from — currently
-- only the 6,400-row North American university dataset, which cannot live in the
-- `options` text array. See the enum comments in schema.prisma.
--
-- No new `QuestionType`: DROPDOWN is now always searchable, so a 6,400-entry list and
-- a six-entry one are the same question type rendered by the same control.

-- CreateEnum
CREATE TYPE "LinkedField" AS ENUM ('NAME', 'UNIVERSITY', 'YEAR');

-- CreateEnum
CREATE TYPE "OptionPreset" AS ENUM ('UNIVERSITIES_NA');

-- AlterTable
ALTER TABLE "Question" ALTER COLUMN "linkedField" TYPE "LinkedField"
USING (CASE upper("linkedField")
         WHEN 'NAME' THEN 'NAME'
         WHEN 'UNIVERSITY' THEN 'UNIVERSITY'
         WHEN 'YEAR' THEN 'YEAR'
       END)::"LinkedField";

-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "optionPreset" "OptionPreset";
