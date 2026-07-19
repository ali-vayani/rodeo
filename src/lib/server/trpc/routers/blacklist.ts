import { z } from 'zod';
import { router, adminProcedure } from '../init';

const entryInput = z.object({
	name: z.string().min(1),
	email: z.string().email({ error: 'Please enter a valid email address' }),
	reason: z.string().optional()
});

/** Normalize an email so the unique index matches case- and whitespace-insensitively. */
const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const blacklistRouter = router({
	list: adminProcedure.query(async ({ ctx }) => {
		return ctx.prisma.blacklist.findMany({ orderBy: { createdAt: 'desc' } });
	}),

	add: adminProcedure.input(entryInput).mutation(async ({ ctx, input }) => {
		const email = normalizeEmail(input.email);
		// Upsert so re-adding an existing email updates its name/reason instead of throwing on the unique constraint.
		return ctx.prisma.blacklist.upsert({
			where: { email },
			create: { name: input.name, email, reason: input.reason },
			update: { name: input.name, reason: input.reason }
		});
	}),

	addBulk: adminProcedure.input(z.array(entryInput)).mutation(async ({ ctx, input }) => {
		const data = input.map((e) => ({ ...e, email: normalizeEmail(e.email) }));
		return ctx.prisma.blacklist.createMany({ data, skipDuplicates: true });
	}),

	remove: adminProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
		return ctx.prisma.blacklist.delete({ where: { id: input.id } });
	})
});
