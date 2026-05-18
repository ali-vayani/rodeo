import type { PageServerLoad } from './$types';
import { prisma } from '$lib/server/db';

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = locals.user!;

	const joinCode = url.searchParams.get('join');

	const [questions, responses, settings] = await Promise.all([
		prisma.question.findMany({ orderBy: { order: 'asc' } }),
		prisma.applicationResponse.findMany({ where: { userId: user.uid } }),
		prisma.settings.findFirst()
	]);

	let joinTeam: { teamName: string; memberCount: number; inviteCode: string } | null = null;

	if (joinCode) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const team = await (prisma.team.findUnique as any)({
			where: { inviteCode: joinCode },
			include: { members: true }
		}) as { id: string; teamName: string; inviteCode: string; members: unknown[] } | null;

		if (team) {
			joinTeam = { teamName: team.teamName, memberCount: team.members.length, inviteCode: team.inviteCode };
		}
	}

	return { user, questions, responses, settings, joinTeam };
};
