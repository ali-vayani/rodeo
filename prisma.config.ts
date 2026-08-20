import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// This file is read only by the Prisma CLI (migrate, db seed, studio). The app builds
// its own client in src/lib/server/db.ts from DATABASE_URL.
//
// Migrations cannot run through Supabase's transaction pooler (port 6543), so the CLI
// prefers DIRECT_URL and falls back to DATABASE_URL for local dev.
//
// Left undefined when neither is set, so `prisma generate` works where no database is
// configured. Migration commands then fail with Prisma's own "datasource required"
// error instead of a config-load crash.
//
// DATABASE_SCHEMA scopes migrations to a per-branch schema on preview deploys; unset
// means the default `public` schema.
const base = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const schema = process.env.DATABASE_SCHEMA;
const url = base && schema ? `${base}${base.includes('?') ? '&' : '?'}schema=${schema}` : base;

export default defineConfig({
	schema: 'prisma/schema.prisma',
	migrations: {
		path: 'prisma/migrations',
		seed: 'npx tsx prisma/seed.ts'
	},
	...(url ? { datasource: { url } } : {})
});
