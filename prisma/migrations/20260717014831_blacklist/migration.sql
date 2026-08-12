/*
  Warnings:

  - You are about to drop the column `type` on the `Blacklist` table. All the data in the column will be lost.
  - You are about to drop the column `value` on the `Blacklist` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[email]` on the table `Blacklist` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `email` to the `Blacklist` table without a default value. This is not possible if the table is not empty.
  - Added the required column `name` to the `Blacklist` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Blacklist" DROP COLUMN "type",
DROP COLUMN "value",
ADD COLUMN     "email" TEXT NOT NULL,
ADD COLUMN     "name" TEXT NOT NULL,
ADD COLUMN     "reason" TEXT;

-- DropEnum
DROP TYPE "BlacklistType";

-- CreateIndex
CREATE UNIQUE INDEX "Blacklist_email_key" ON "Blacklist"("email");
