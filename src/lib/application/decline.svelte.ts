import { UserStatus } from '$lib/generated/prisma/enums';
import { createClient } from '$lib/trpc/client';

type UserWithStatus = { status: UserStatus };

export function createDeclineHandler(options: { user: UserWithStatus; onSuccess?: () => void }) {
	const trpc = createClient();
	let declining = $state(false);

	async function handleDecline() {
		declining = true;
		try {
			await trpc.application.rsvpDecline.mutate();
			options.user.status = UserStatus.DECLINED;
			options.onSuccess?.();
		} catch {
			// silently leave state unchanged; modal stays open
		} finally {
			declining = false;
		}
	}

	return {
		get declining() {
			return declining;
		},
		handleDecline
	};
}
