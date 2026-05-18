import type { PageServerLoad } from './$types';
import { prisma } from '$lib/server/db';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!;

	const [questions, responses, settings] = await Promise.all([
		prisma.question.findMany({ orderBy: { order: 'asc' } }),
		prisma.applicationResponse.findMany({ where: { userId: user.uid } }),
		prisma.settings.findFirst()
	]);

	return { user, questions, responses, settings };
};
