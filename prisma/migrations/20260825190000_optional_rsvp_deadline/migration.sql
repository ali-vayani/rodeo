-- A null RSVP deadline means confirmations never close; the wallet unlock
-- latches onto the event start instead.
ALTER TABLE "Settings" ALTER COLUMN "RSVPDeadline" DROP NOT NULL;
