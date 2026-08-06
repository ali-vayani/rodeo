import { z } from 'zod';
import { router, authedProcedure, adminProcedure } from '../init';
import { TEMPLATE_KEYS, type TemplateKey } from '$lib/email/templates';
import { isAdmin } from '$lib/auth/permissions';
import { logAction, listOrNone } from '$lib/server/log';

// Same bounds `updateTemplates` enforces — a subject is 1–200 chars, a body ≤20k. This
// full-object PUT is the other write path to those columns, and leaving it unbounded let
// it store an empty subject or a multi-megabyte template that `admissions.release` mails.
const subject = z.string().min(1).max(200);
const templateBody = z.string().max(20000);

const settingsInput = z
	.object({
		applicationOpen: z.coerce.date(),
		applicationDeadline: z.coerce.date(),
		RSVPDeadline: z.coerce.date(),
		admissionsSend: z.coerce.date().optional(),
		hackathonStartDate: z.coerce.date(),
		scanActions: z.array(z.string().min(1).max(100)).max(50),
		submitTemplate: templateBody,
		submitSubject: subject,
		acceptTemplate: templateBody,
		acceptSubject: subject,
		confirmTemplate: templateBody,
		confirmSubject: subject,
		declineTemplate: templateBody,
		declineSubject: subject,
		rejectTemplate: templateBody,
		rejectSubject: subject,
		waitlistTemplate: templateBody,
		waitlistSubject: subject,
		timezone: z.string().min(1)
	})
	// Applications must open before they close, and RSVP can't fall before the deadline —
	// otherwise the window guards lock every applicant out with a nonsensical message.
	.refine((s) => s.applicationOpen <= s.applicationDeadline, {
		message: 'Applications must open before they close.',
		path: ['applicationDeadline']
	})
	.refine((s) => s.applicationDeadline <= s.RSVPDeadline, {
		message: 'The RSVP deadline must be on or after the application deadline.',
		path: ['RSVPDeadline']
	});

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
	timezone: 'America/Chicago'
};

type TemplateColumns = Record<`${TemplateKey}Template` | `${TemplateKey}Subject`, string>;

/**
 * The lifecycle template and subject columns, emptied.
 *
 * `settings.get` is `authedProcedure` because non-admins genuinely need parts of
 * this row: the hacker portal reads the RSVP deadline and start date, the scan
 * page reads `scanActions`, the schedule page reads the start date and timezone.
 * The six templates and their subjects are internal copy, and every hacker being
 * able to read them is not something any of those callers asked for.
 *
 * Emptied rather than omitted: the same payload feeds components typed against the
 * full `Settings` row, so dropping keys would make the response shape depend on
 * who asked. Every caller keeps the fields; only an admin gets their contents.
 *
 * Derived from `TEMPLATE_KEYS` so a seventh template is covered the day it lands,
 * rather than leaking until someone remembers this list exists.
 */
const REDACTED_TEMPLATES = Object.fromEntries(
	TEMPLATE_KEYS.flatMap((key) => [
		[`${key}Template`, ''],
		[`${key}Subject`, '']
	])
) as TemplateColumns;

/**
 * Which keys of `next` differ from `previous`.
 *
 * Dates arrive as `Date` and arrays as `string[]`, so `!==` alone would report
 * every field as changed on every save. Both are compared by value.
 */
function changedFields(previous: Record<string, unknown>, next: Record<string, unknown>): string[] {
	return Object.keys(next).filter((key) => {
		const before = previous[key];
		const after = next[key];

		// `admissionsSend` is nullable in the column and optional in the input, so
		// an untouched empty value arrives as `undefined` against a stored `null`.
		if (before == null || after == null) return (before ?? null) !== (after ?? null);

		if (before instanceof Date || after instanceof Date) {
			return new Date(before as Date).getTime() !== new Date(after as Date).getTime();
		}
		if (Array.isArray(before) || Array.isArray(after)) {
			return JSON.stringify(before) !== JSON.stringify(after);
		}
		return before !== after;
	});
}

export const settingsRouter = router({
	get: authedProcedure.query(async ({ ctx }) => {
		const settings = (await ctx.prisma.settings.findFirst()) ?? DEFAULT_SETTINGS;
		if (isAdmin(ctx.user.roles)) return settings;
		return { ...settings, ...REDACTED_TEMPLATES };
	}),

	update: adminProcedure.input(settingsInput).mutation(async ({ ctx, input }) => {
		const existing = await ctx.prisma.settings.findFirst();

		// The page is a full-object PUT, so every save sends all nineteen columns.
		// Logging "updated settings" would be true of every entry and useful in
		// none — name the fields that actually moved.
		const changed = existing ? changedFields(existing, input) : Object.keys(input);

		const settings = existing
			? await ctx.prisma.settings.update({ where: { id: existing.id }, data: input })
			: await ctx.prisma.settings.create({ data: input });

		await logAction(ctx, {
			action: 'settings.update',
			summary: existing
				? `Updated settings (${listOrNone(changed)})`
				: 'Created the initial settings row',
			metadata: { changed }
		});

		return settings;
	}),

	/**
	 * Writes only the template/subject columns.
	 *
	 * `update` is a full-object PUT, so an admin saving templates would clobber a
	 * concurrent edit to the dates or timezone. This touches nothing else.
	 */
	updateTemplates: adminProcedure
		.input(
			z.object({
				// partialRecord, not record: the page sends only the templates the
				// admin actually edited, so requiring all six keys would reject it.
				templates: z.partialRecord(
					z.enum(TEMPLATE_KEYS),
					z.object({
						subject: z.string().min(1).max(200),
						body: z.string().max(20000)
					})
				)
			})
		)
		.mutation(async ({ ctx, input }) => {
			const data: Record<string, string> = {};
			for (const [key, value] of Object.entries(input.templates)) {
				data[`${key}Subject`] = value.subject;
				data[`${key}Template`] = value.body;
			}

			const existing = await ctx.prisma.settings.findFirst();
			const settings = existing
				? await ctx.prisma.settings.update({ where: { id: existing.id }, data })
				: // Fresh install: seed.ts doesn't create a Settings row, so `get` served
					// DEFAULT_SETTINGS and there is nothing to update yet. Materialise it.
					await ctx.prisma.settings.create({ data: { ...DEFAULT_SETTINGS, ...data } });

			const edited = Object.keys(input.templates);
			await logAction(ctx, {
				action: 'settings.templates.update',
				summary: `Updated the ${listOrNone(edited)} email ${edited.length === 1 ? 'template' : 'templates'}`,
				// Bodies are not stored here — they can run to 20k characters each, and
				// the trail records that they changed, not what they said.
				metadata: { templates: edited }
			});

			return settings;
		})
});
