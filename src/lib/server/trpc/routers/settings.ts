import { z } from 'zod';
import { router, authedProcedure, adminProcedure } from '../init';
import { TEMPLATE_KEYS, type TemplateKey } from '$lib/email/templates';
import { isAdmin } from '$lib/auth/permissions';
import { DEFAULT_SETTINGS } from '$lib/server/settings';
import { US_STATES } from '$lib/data/states';
import { logAction, listOrNone } from '$lib/server/log';

// Same bounds as `updateTemplates`; `update` is the other write path to these columns
// and `admissions.release` mails whatever is stored.
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
		timezone: z.string().min(1),
		// Checked against the list, not "two letters", so a typo can't become a state
		// that filters to zero rows.
		homeState: z
			.string()
			.refine((code) => code in US_STATES, { message: 'Not a US state.' })
			.nullable()
			.optional()
	})
	// Out-of-order dates make the window guards lock every applicant out.
	.refine((s) => s.applicationOpen <= s.applicationDeadline, {
		message: 'Applications must open before they close.',
		path: ['applicationDeadline']
	})
	.refine((s) => s.applicationDeadline <= s.RSVPDeadline, {
		message: 'The RSVP deadline must be on or after the application deadline.',
		path: ['RSVPDeadline']
	});

// Re-exported for existing importers; lives in `$lib/server/settings` so the senders
// resolve the same values the editor sees.
export { DEFAULT_SETTINGS };

type TemplateColumns = Record<`${TemplateKey}Template` | `${TemplateKey}Subject`, string>;

/**
 * Template and subject columns blanked for non-admin `settings.get` callers, who need
 * the deadlines and `scanActions` but not internal email copy. Emptied rather than
 * omitted because the payload feeds components typed against the full `Settings` row.
 * Derived from `TEMPLATE_KEYS` so a new template is covered automatically.
 */
const REDACTED_TEMPLATES = Object.fromEntries(
	TEMPLATE_KEYS.flatMap((key) => [
		[`${key}Template`, ''],
		[`${key}Subject`, '']
	])
) as TemplateColumns;

/**
 * Which keys of `next` differ from `previous`. Dates arrive as `Date` and arrays as
 * `string[]`, so `!==` alone would report every field as changed on every save.
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
		if (isAdmin(ctx.user.role)) return settings;
		return { ...settings, ...REDACTED_TEMPLATES };
	}),

	update: adminProcedure.input(settingsInput).mutation(async ({ ctx, input }) => {
		const existing = await ctx.prisma.settings.findFirst();

		// Every save sends all columns, so diff to find what actually changed.
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
	 * Writes only the template/subject columns. `update` is a full-object PUT, so an admin
	 * saving templates would otherwise clobber a concurrent edit to the dates or timezone.
	 */
	updateTemplates: adminProcedure
		.input(
			z.object({
				// partialRecord: the page sends only the templates the admin edited.
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
				: // Fresh install: seed.ts creates no Settings row, so materialise one.
					await ctx.prisma.settings.create({ data: { ...DEFAULT_SETTINGS, ...data } });

			const edited = Object.keys(input.templates);
			await logAction(ctx, {
				action: 'settings.templates.update',
				summary: `Updated the ${listOrNone(edited)} email ${edited.length === 1 ? 'template' : 'templates'}`,
				// Bodies run to 20k characters each; the trail records that they changed.
				metadata: { templates: edited }
			});

			return settings;
		})
});
