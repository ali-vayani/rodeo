-- Storage refs for files attached to a custom email send.
ALTER TABLE "EmailLog" ADD COLUMN "attachments" JSONB NOT NULL DEFAULT '[]';
