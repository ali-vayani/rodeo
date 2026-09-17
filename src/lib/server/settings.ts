/**
 * The Settings row's stand-in, and the rule for when standing in is correct.
 *
 * A fresh install has no Settings row. `settings.get` served `DEFAULT_SETTINGS` while
 * the senders read the row directly and guarded on a falsy template, so the editor
 * showed copy that existed nowhere and every lifecycle email silently stopped. Both
 * now resolve the same values through this module.
 *
 * Deliberately NOT applied to the window guards, which read an absent row as "no window
 * enforced". The dates here are `new Date()` at import, so substituting them would lock
 * every applicant out. Email copy has a safe default; a deadline does not.
 */
export const DEFAULT_SETTINGS = {
	applicationOpen: new Date(),
	applicationDeadline: new Date(),
	RSVPDeadline: null as Date | null,
	admissionsSend: null,
	hackathonStartDate: new Date(),
	scanActions: ['Check-In'],
	hackerApplicationOpen: null as Date | null,
	hackerApplicationDeadline: null as Date | null,
	mentorApplicationOpen: null as Date | null,
	mentorApplicationDeadline: null as Date | null,
	judgeApplicationOpen: null as Date | null,
	judgeApplicationDeadline: null as Date | null,
	volunteerApplicationOpen: null as Date | null,
	volunteerApplicationDeadline: null as Date | null,
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
 * The settings an outbound message should be rendered against. Always returns
 * something: a missing row means "not configured yet", never "send nothing".
 */
export function emailSettings<T>(row: T | null): T | typeof DEFAULT_SETTINGS {
	return row ?? DEFAULT_SETTINGS;
}
