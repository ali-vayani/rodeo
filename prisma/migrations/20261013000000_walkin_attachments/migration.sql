-- The walk-in template joined TEMPLATE_KEYS on a branch that predates per-template
-- attachments, so it missed the column every other key got in
-- 20261005000000_template_email_attachments. The settings router derives
-- `<key>Attachments` from TEMPLATE_KEYS, so the column must exist for every key.
ALTER TABLE "Settings" ADD COLUMN "walkinAttachments" JSONB NOT NULL DEFAULT '[]';
