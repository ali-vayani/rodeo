import type { PrismaClient } from '$lib/generated/prisma/client';

export async function createLog(
	prisma: PrismaClient,
	action: string,
	userId?: string
): Promise<void> {
	await prisma.log.create({
		data: { action, userId }
	});
}
