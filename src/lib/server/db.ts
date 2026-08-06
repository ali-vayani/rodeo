import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '$lib/generated/prisma/client';
import { env } from '$env/dynamic/private';

const globalForPrisma = globalThis as unknown as {
	prisma: PrismaClient;
};

function createClient() {
	const url = env.DATABASE_URL;
	if (!url) {
		throw new Error('DATABASE_URL is not set');
	}
	const adapter = new PrismaPg({
		connectionString: url,
		// Supabase's poolers present a certificate chain node-pg can't verify
		// against its default CAs, and node-pg reads sslmode=require as
		// verify-full. psql and prisma migrate read it as "encrypt, don't
		// verify" — give node-pg those libpq semantics so one URL works for
		// all three. Local URLs carry no sslmode, so local dev stays plain TCP.
		...(url.includes('sslmode=require') ? { ssl: { rejectUnauthorized: false } } : {}),
		// Every warm serverless instance holds its own pool, and many instances
		// can run at once — keep the per-instance cap small so they don't
		// collectively exhaust Supavisor's client-connection limit. Local dev is
		// a single process, where 3 is still plenty.
		max: Number(env.DATABASE_POOL_MAX ?? 3),
		idleTimeoutMillis: 30_000,
		connectionTimeoutMillis: 10_000
	});
	return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
