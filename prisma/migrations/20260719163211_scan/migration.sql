/*
  Warnings:

  - You are about to drop the column `email` on the `Blacklist` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `Blacklist` table. All the data in the column will be lost.
  - You are about to drop the column `reason` on the `Blacklist` table. All the data in the column will be lost.
  - Added the required column `type` to the `Blacklist` table without a default value. This is not possible if the table is not empty.
  - Added the required column `value` to the `Blacklist` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "BlacklistType" AS ENUM ('EMAIL', 'NAME');

-- DropIndex
DROP INDEX "Blacklist_email_key";

-- AlterTable
ALTER TABLE "Blacklist" DROP COLUMN "email",
DROP COLUMN "name",
DROP COLUMN "reason",
ADD COLUMN     "type" "BlacklistType" NOT NULL,
ADD COLUMN     "value" TEXT NOT NULL;
