-- Rubric-based scoring: organizers define criteria (rows) with levels (cells), each
-- level carrying its own point value. A reviewer picks one level per criterion; the
-- saved total on "User"."score" is frozen at save time, plus a manual delta.
ALTER TABLE "User" ADD COLUMN "scoreDelta" INTEGER;

CREATE TABLE "RubricCriterion" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RubricCriterion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RubricLevel" (
    "id" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RubricLevel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RubricSelection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "levelId" TEXT NOT NULL,

    CONSTRAINT "RubricSelection_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RubricLevel_criterionId_idx" ON "RubricLevel"("criterionId");

CREATE UNIQUE INDEX "RubricSelection_userId_criterionId_key" ON "RubricSelection"("userId", "criterionId");

CREATE INDEX "RubricSelection_criterionId_idx" ON "RubricSelection"("criterionId");

CREATE INDEX "RubricSelection_levelId_idx" ON "RubricSelection"("levelId");

ALTER TABLE "RubricLevel" ADD CONSTRAINT "RubricLevel_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "RubricCriterion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RubricSelection" ADD CONSTRAINT "RubricSelection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("uid") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RubricSelection" ADD CONSTRAINT "RubricSelection_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "RubricCriterion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RubricSelection" ADD CONSTRAINT "RubricSelection_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "RubricLevel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
