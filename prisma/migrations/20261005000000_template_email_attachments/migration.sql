ALTER TABLE "Settings" ADD COLUMN "submitAttachments" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Settings" ADD COLUMN "acceptAttachments" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Settings" ADD COLUMN "rejectAttachments" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Settings" ADD COLUMN "waitlistAttachments" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Settings" ADD COLUMN "confirmAttachments" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Settings" ADD COLUMN "declineAttachments" JSONB NOT NULL DEFAULT '[]';
