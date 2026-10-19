-- The Projects tab in both portals: an admin toggle and the feed it reads from.
ALTER TABLE "Settings" ADD COLUMN "projectsEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Settings" ADD COLUMN "projectsUrl" TEXT;
