-- The six lifecycle subject lines shipped with the email-templates page but were
-- applied to the development database with `prisma db push`, so migrate history
-- never recorded them. This backfills that gap; every column carries the same
-- default as the schema, which is what lets it run against a populated table.
ALTER TABLE "Settings"
    ADD COLUMN IF NOT EXISTS "submitSubject"   TEXT NOT NULL DEFAULT 'We received your application',
    ADD COLUMN IF NOT EXISTS "acceptSubject"   TEXT NOT NULL DEFAULT 'You''ve been accepted!',
    ADD COLUMN IF NOT EXISTS "confirmSubject"  TEXT NOT NULL DEFAULT 'Your RSVP is confirmed',
    ADD COLUMN IF NOT EXISTS "declineSubject"  TEXT NOT NULL DEFAULT 'Your RSVP has been declined',
    ADD COLUMN IF NOT EXISTS "rejectSubject"   TEXT NOT NULL DEFAULT 'An update on your application',
    ADD COLUMN IF NOT EXISTS "waitlistSubject" TEXT NOT NULL DEFAULT 'You''re on the waitlist';
