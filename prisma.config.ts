import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// This file is read only by the Prisma CLI (migrate, db seed, studio) — the
// app builds its own client in src/lib/server/db.ts from DATABASE_URL.
//
// Migrations cannot run through Supabase's transaction pooler (port 6543), so
// the CLI prefers DIRECT_URL — the session-pooler/direct connection — and
// falls back to DATABASE_URL for local dev, where the two are the same server.
//
// Left undefined when neither is set so `prisma generate` — run by the
// `prepare` script during `npm ci` — works where no database is configured
// (CI test job, Vercel build). Migration commands then fail with Prisma's own
// "datasource required" error instead of a config-load crash.
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

export default defineConfig({
	schema: 'prisma/schema.prisma',
	migrations: {
		path: 'prisma/migrations',
		seed: 'npx tsx prisma/seed.ts'
	},
	...(url ? { datasource: { url } } : {})
});
