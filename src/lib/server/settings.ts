/**
 * The Settings row's stand-in, and the rule for when standing in is correct.
 *
 * `seed.ts` creates no Settings row, so a fresh install — and production, until
 * someone saves /admin/settings once — has none. Two kinds of reader disagreed
 * about what that meant, which is how every lifecycle email silently stopped:
 *
 * - `settings.get` served `DEFAULT_SETTINGS`, so the template editor rendered six
 *   healthy-looking templates.
 * - The senders read the row directly and guarded on `settings?.submitTemplate`,
 *   which is falsy when the row is absent, so they sent nothing and said nothing.
 *
 * The editor showed copy that existed nowhere and the senders skipped mail nobody
 * knew was skipped. Both now resolve the same values through this module.
 *
 * Deliberately NOT applied to the application/RSVP window guards: they read an
 * absent row as "no window enforced" on purpose (see `assertWithinApplicationWindow`),
 * and the three dates here are `new Date()` evaluated at import — already expired by
 * the time the process has been up a second. Substituting them there would lock every
 * applicant out of an unconfigured event. Email copy has a safe default; a deadline
 * does not.
 */
export const DEFAULT_SETTINGS = {
	applicationOpen: new Date(),
	applicationDeadline: new Date(),
	RSVPDeadline: new Date(),
	admissionsSend: null,
	hackathonStartDate: new Date(),
	scanActions: ['Check-In'],
	submitTemplate: 'Hi {{name}}, your application has been submitted!',
	submitSubject: 'We received your application',
	acceptTemplate: 'Hi {{name}}, you have been accepted!',
	acceptSubject: "You've been accepted!",
	confirmTemplate: 'Hi {{name}}, your RSVP has been confirmed!',
	confirmSubject: 'Your RSVP is confirmed',
	declineTemplate: 'Hi {{name}}, your spot has been declined.',
	declineSubject: 'Your RSVP has been declined',
	rejectTemplate: 'Hi {{name}}, we regret to inform you that your application was not accepted.',
	rejectSubject: 'An update on your application',
	waitlistTemplate: 'Hi {{name}}, you have been added to the waitlist.',
	waitlistSubject: "You're on the waitlist",
	timezone: 'America/Chicago',
	homeState: null as string | null
};

/**
 * The settings an outbound message should be rendered against.
 *
 * Always returns something: a missing row means "not configured yet", never "send
 * nothing". Callers that also enforce deadlines must keep reading the raw row for
 * that — this is the email half only.
 */
export function emailSettings<T>(row: T | null): T | typeof DEFAULT_SETTINGS {
	return row ?? DEFAULT_SETTINGS;
}
