-- AlterTable
ALTER TABLE "EmailLog" ALTER COLUMN "sent" DROP DEFAULT,
ALTER COLUMN "failed" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "hackerApplicationDeadline" TIMESTAMP(3),
ADD COLUMN     "hackerApplicationOpen" TIMESTAMP(3),
ADD COLUMN     "judgeApplicationDeadline" TIMESTAMP(3),
ADD COLUMN     "judgeApplicationOpen" TIMESTAMP(3),
ADD COLUMN     "mentorApplicationDeadline" TIMESTAMP(3),
ADD COLUMN     "mentorApplicationOpen" TIMESTAMP(3),
ADD COLUMN     "volunteerApplicationDeadline" TIMESTAMP(3),
ADD COLUMN     "volunteerApplicationOpen" TIMESTAMP(3);
