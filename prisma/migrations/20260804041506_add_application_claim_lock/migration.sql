-- AlterTable
ALTER TABLE "User" ADD COLUMN     "claimedAt" TIMESTAMP(3),
ADD COLUMN     "claimedBy" TEXT;

-- CreateIndex
CREATE INDEX "User_claimedBy_idx" ON "User"("claimedBy");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_claimedBy_fkey" FOREIGN KEY ("claimedBy") REFERENCES "User"("uid") ON DELETE SET NULL ON UPDATE CASCADE;

