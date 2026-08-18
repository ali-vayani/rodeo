-- The event's home state, so the applicant filters can say "Texas" rather than
-- "Home state".
--
-- Nullable and with no default. An event that hasn't set one still gets the State
-- filter — it is derived from each applicant's university through the bundled
-- university dataset, not from anything stored here — it just has no state pinned to
-- the top of the list and no "Outside <state>" row. A default of 'TX' would have been
-- a guess written into every installation.
ALTER TABLE "Settings" ADD COLUMN "homeState" TEXT;
