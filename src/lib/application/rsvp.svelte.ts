import { UserStatus } from '$lib/generated/prisma/enums';
import { createClient } from '$lib/trpc/client';

type UserWithStatus = { status: UserStatus };

export function createRsvpHandler(options: {
	user: UserWithStatus;
	onSuccess?: () => void;
}) {
	const trpc = createClient();
	let rsvping = $state(false);

	async function handleRsvp() {
		rsvping = true;
		try {
			await trpc.application.rsvp.mutate();
			options.user.status = UserStatus.CONFIRMED;
			options.onSuccess?.();
		} catch {
			// silently leave state unchanged; user sees the button again
		} finally {
			rsvping = false;
		}
	}

	return {
		get rsvping() {
			return rsvping;
		},
		handleRsvp
	};
}
