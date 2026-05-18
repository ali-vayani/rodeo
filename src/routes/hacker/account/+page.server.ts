import type { PageServerLoad } from './$types';
import { prisma } from '$lib/server/db';
import { InvitationStatus } from '$lib/generated/prisma/enums';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!;
	const settings = await prisma.settings.findFirst();

	const fullUser = await prisma.user.findUniqueOrThrow({
		where: { uid: user.uid },
		include: {
			team: {
				include: {
					members: true,
					invitations: {
						where: { status: InvitationStatus.PENDING },
						include: { user: true }
					}
				}
			},
			invitations: {
				where: { status: InvitationStatus.PENDING },
				include: { team: { include: { members: true } } }
			}
		}
	});

	return { user: fullUser, settings };
};
