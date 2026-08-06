import { UserStatus } from '$lib/generated/prisma/enums';
import { createClient } from '$lib/trpc/client';
import { errorMessage } from '$lib/ui/errors';

type UserWithStatus = { status: UserStatus };

/**
 * Releasing a spot. Mirrors `createRsvpHandler`, including surfacing `error` —
 * this one failed inside a confirmation modal, so a swallowed rejection left the
 * dialog sitting open with no explanation at all.
 */
export function createDeclineHandler(options: { user: UserWithStatus; onSuccess?: () => void }) {
	const trpc = createClient();
	let declining = $state(false);
	let error = $state<string | null>(null);

	async function handleDecline() {
		declining = true;
		error = null;
		try {
			await trpc.application.rsvpDecline.mutate();
			options.user.status = UserStatus.DECLINED;
			options.onSuccess?.();
		} catch (e) {
			error = errorMessage(e, 'Could not release your spot. Please try again.');
		} finally {
			declining = false;
		}
	}

	return {
		get declining() {
			return declining;
		},
		get error() {
			return error;
		},
		handleDecline
	};
}
