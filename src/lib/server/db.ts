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
	const adapter = new PrismaPg({ connectionString: url });
	return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
