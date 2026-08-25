-- Why each recipient failed, keyed by the same identifier `failed` stores.
ALTER TABLE "EmailLog" ADD COLUMN "errors" JSONB NOT NULL DEFAULT '{}';
