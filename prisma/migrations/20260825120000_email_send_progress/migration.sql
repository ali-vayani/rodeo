-- Per-send progress, so an interrupted blast leaves a record of who was reached.
ALTER TABLE "EmailLog" ADD COLUMN "sent" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "EmailLog" ADD COLUMN "failed" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
