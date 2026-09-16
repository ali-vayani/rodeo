-- Dietary restrictions live in application responses; lunch assignments are separate
-- so an admin can regenerate or edit them without changing a user's profile.
ALTER TYPE "LinkedField" ADD VALUE 'DIETARY_RESTRICTION';

CREATE TYPE "LunchGroupPool" AS ENUM ('DIETARY_RESTRICTION', 'NO_RESTRICTION');

CREATE TABLE "LunchGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pool" "LunchGroupPool" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LunchGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LunchGroupMember" (
    "id" TEXT NOT NULL,
    "lunchGroupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "LunchGroupMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LunchGroupMember_userId_key" ON "LunchGroupMember"("userId");
CREATE UNIQUE INDEX "LunchGroupMember_lunchGroupId_userId_key" ON "LunchGroupMember"("lunchGroupId", "userId");

ALTER TABLE "LunchGroupMember" ADD CONSTRAINT "LunchGroupMember_lunchGroupId_fkey"
  FOREIGN KEY ("lunchGroupId") REFERENCES "LunchGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LunchGroupMember" ADD CONSTRAINT "LunchGroupMember_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("uid") ON DELETE CASCADE ON UPDATE CASCADE;
