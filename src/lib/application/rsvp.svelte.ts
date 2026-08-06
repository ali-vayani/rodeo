import { UserStatus } from '$lib/generated/prisma/enums';
import { createClient } from '$lib/trpc/client';
import { errorMessage } from '$lib/ui/errors';

type UserWithStatus = { status: UserStatus };

/**
 * Confirming a spot.
 *
 * `error` exists because this handler used to swallow the rejection entirely. Every
 * reason `application.rsvp` refuses is a sentence written for the applicant to read —
 * the RSVP deadline has passed, the spot was already released, the decision isn't
 * ACCEPTED — and dropping it turned all of them into a button that visibly does
 * nothing. That is the worst possible rendering of a rule: the applicant cannot tell
 * a closed deadline from a broken page, and neither can whoever they report it to.
 */
export function createRsvpHandler(options: { user: UserWithStatus; onSuccess?: () => void }) {
	const trpc = createClient();
	let rsvping = $state(false);
	let error = $state<string | null>(null);

	async function handleRsvp() {
		rsvping = true;
		error = null;
		try {
			await trpc.application.rsvp.mutate();
			options.user.status = UserStatus.CONFIRMED;
			options.onSuccess?.();
		} catch (e) {
			error = errorMessage(e, 'Could not confirm your RSVP. Please try again.');
		} finally {
			rsvping = false;
		}
	}

	return {
		get rsvping() {
			return rsvping;
		},
		get error() {
			return error;
		},
		handleRsvp
	};
}
