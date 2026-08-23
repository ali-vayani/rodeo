import { z } from 'zod';
import { router, adminProcedure } from '../init';
import { normalizeEmail, normalizeName } from '$lib/blacklist/match';
import { logAction } from '$lib/server/log';

/** Ceiling on a single CSV import, so a malformed file can't turn into an unbounded insert. */
const MAX_IMPORT_ROWS = 5000;

const entryInput = z.object({
	firstName: z.string().trim().min(1, 'First name is required'),
	lastName: z.string().trim().min(1, 'Last name is required'),
	// Optional so an organizer can blacklist a name they have no address for. Such an
	// entry flags at review time but never auto-rejects, since only email carries that.
	email: z.string().trim().email('Invalid email address').optional(),
	reason: z.string().trim().optional()
});

/**
 * Deliberately loose: `z.array(entryInput)` would reject the whole CSV over one bad
 * address. Rows are checked individually in `addBulk` and failures reported by position.
 */
const importRowInput = z.object({
	firstName: z.string(),
	lastName: z.string(),
	email: z.string().optional(),
	reason: z.string().optional()
});

/** Empty string from an optional CSV column means "absent", not "blank value". */
const blank = (value: string | undefined) => (value?.trim() ? value.trim() : undefined);

/** Key identifying a name-only entry, used to keep imports idempotent (see `addBulk`). */
const nameKey = (firstName: string, lastName: string) =>
	`${normalizeName(firstName)} ${normalizeName(lastName)}`;

export const blacklistRouter = router({
	list: adminProcedure.query(async ({ ctx }) => {
		return ctx.prisma.blacklist.findMany({ orderBy: { createdAt: 'desc' } });
	}),

	add: adminProcedure.input(entryInput).mutation(async ({ ctx, input }) => {
		const email = input.email ? normalizeEmail(input.email) : undefined;
		const data = {
			firstName: input.firstName,
			lastName: input.lastName,
			email,
			reason: input.reason
		};

		// Retyping an existing address means "correct the entry", so upsert rather than
		// fail on the unique index. Name-only rows have no key to upsert against.
		const entry = email
			? await ctx.prisma.blacklist.upsert({
					where: { email },
					create: data,
					update: { firstName: input.firstName, lastName: input.lastName, reason: input.reason }
				})
			: await ctx.prisma.blacklist.create({ data });

		const name = `${entry.firstName} ${entry.lastName}`;
		await logAction(ctx, {
			action: 'blacklist.add',
			// Email vs name-only decides auto-reject vs flag, so it goes in the sentence.
			summary: email
				? `Blacklisted ${name} (${email})`
				: `Blacklisted the name ${name} (no email — flags for review only)`,
			target: { id: entry.id, label: name },
			metadata: { email: email ?? null, reason: entry.reason ?? null }
		});

		return entry;
	}),

	/**
	 * CSV import. Partial success is the contract: valid rows insert, invalid rows are
	 * reported with their position, nothing rolls back. Unlike `add`, never overwrites an
	 * existing entry, which would revert hand-curated reasons.
	 */
	addBulk: adminProcedure
		.input(z.object({ rows: z.array(importRowInput).max(MAX_IMPORT_ROWS) }))
		.mutation(async ({ ctx, input }) => {
			const invalid: { row: number; reason: string }[] = [];
			const valid: { firstName: string; lastName: string; email?: string; reason?: string }[] = [];

			input.rows.forEach((raw, index) => {
				const parsed = entryInput.safeParse({
					firstName: raw.firstName,
					lastName: raw.lastName,
					email: blank(raw.email),
					reason: blank(raw.reason)
				});

				if (!parsed.success) {
					// +1 because admins count CSV rows from one, not zero.
					invalid.push({ row: index + 1, reason: parsed.error.issues[0].message });
					return;
				}

				valid.push({
					...parsed.data,
					email: parsed.data.email ? normalizeEmail(parsed.data.email) : undefined
				});
			});

			// `skipDuplicates` only covers rows with an address (the unique index). Name-only
			// rows are deduplicated here against both the file and the table.
			const existingNames = new Set(
				(
					await ctx.prisma.blacklist.findMany({
						where: { email: null },
						select: { firstName: true, lastName: true }
					})
				).map((e) => nameKey(e.firstName, e.lastName))
			);

			const seenNames = new Set<string>();
			const toCreate = valid.filter((entry) => {
				if (entry.email) return true;
				const key = nameKey(entry.firstName, entry.lastName);
				if (existingNames.has(key) || seenNames.has(key)) return false;
				seenNames.add(key);
				return true;
			});

			const { count } = await ctx.prisma.blacklist.createMany({
				data: toCreate,
				skipDuplicates: true
			});

			// Reported separately so the UI never calls a skipped duplicate a success.
			const result = { added: count, duplicates: valid.length - count, invalid };

			await logAction(ctx, {
				action: 'blacklist.import',
				summary:
					`Imported ${count} blacklist ${count === 1 ? 'entry' : 'entries'} ` +
					`(${result.duplicates} duplicate, ${invalid.length} rejected)`,
				metadata: {
					rows: input.rows.length,
					added: count,
					duplicates: result.duplicates,
					invalid: invalid.length
				}
			});

			return result;
		}),

	remove: adminProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
		const entry = await ctx.prisma.blacklist.delete({ where: { id: input.id } });

		const name = `${entry.firstName} ${entry.lastName}`;
		await logAction(ctx, {
			action: 'blacklist.remove',
			summary: `Removed ${name} from the blacklist`,
			target: { id: entry.id, label: name },
			metadata: { email: entry.email, reason: entry.reason }
		});

		return entry;
	})
});
