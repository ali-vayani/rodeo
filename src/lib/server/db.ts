import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '$lib/generated/prisma/client';
import { env } from '$env/dynamic/private';

const globalForPrisma = globalThis as unknown as {
	prisma: PrismaClient;
};

/**
 * Supabase's poolers present a certificate chain node-pg cannot verify against its
 * default CAs, and psql / prisma migrate read `sslmode=require` as "encrypt, don't
 * verify", so one stored URL serves all three consumers. node-pg instead parses it as
 * verify-full and lets the URL win over an explicit `ssl` option, so strip the
 * parameter and pass the intent directly. Local URLs carry no sslmode.
 *
 * Duplicated in prisma/seedShared.ts, which runs under tsx with no $lib aliases.
 */
function poolTls(url: string) {
	if (!url.includes('sslmode=require')) return { connectionString: url };
	const stripped = new URL(url);
	stripped.searchParams.delete('sslmode');
	return { connectionString: stripped.toString(), ssl: { rejectUnauthorized: false } };
}

function createClient() {
	const url = env.DATABASE_URL;
	if (!url) {
		throw new Error('DATABASE_URL is not set');
	}
	const adapter = new PrismaPg(
		{
			...poolTls(url),
			// Every warm serverless instance holds its own pool, and many can run at once,
			// so keep the per-instance cap small enough that they do not collectively
			// exhaust Supavisor's client-connection limit.
			max: Number(env.DATABASE_POOL_MAX ?? 3),
			idleTimeoutMillis: 30_000,
			connectionTimeoutMillis: 10_000
		},
		// Preview deploys are isolated per branch by schema, not by database, since
		// Supabase's pooler only serves the default database. The adapter qualifies
		// generated queries with the schema name, so this is safe through the
		// transaction pooler.
		env.DATABASE_SCHEMA ? { schema: env.DATABASE_SCHEMA } : undefined
	);
	return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
