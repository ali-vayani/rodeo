-- Walk-in registration. Staff invite an email on event day; the invited hacker signs
-- in, answers the walk-in subset of the application if they never applied, and lands
-- CONFIRMED with an ACCEPTED decision, which is what check-in promotes from.
ALTER TABLE "User"
    ADD COLUMN "walkInInvitedAt" TIMESTAMP(3),
    ADD COLUMN "isWalkIn" BOOLEAN NOT NULL DEFAULT false;

-- The subset of the form a walk-in fills out at the door.
ALTER TABLE "Question" ADD COLUMN "walkIn" BOOLEAN NOT NULL DEFAULT false;

-- The invite email template. The body default matches DEFAULT_SETTINGS so the column
-- can be added to a populated table, then it is dropped to match the other template
-- columns, which carry no database default. The subject keeps its schema default.
ALTER TABLE "Settings"
    ADD COLUMN "walkinTemplate" TEXT NOT NULL DEFAULT 'Hi {{name}}, you have been invited as a walk-in! Sign in with this email address and confirm your spot here: {{walkin_link}}',
    ADD COLUMN "walkinSubject" TEXT NOT NULL DEFAULT 'You''re invited as a walk-in';
ALTER TABLE "Settings" ALTER COLUMN "walkinTemplate" DROP DEFAULT;
