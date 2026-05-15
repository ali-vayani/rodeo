import { z } from 'zod';
import { router, authedProcedure, adminProcedure } from '../init';

const settingsInput = z.object({
	applicationOpen: z.coerce.date(),
	applicationDeadline: z.coerce.date(),
	RSVPDeadline: z.coerce.date(),
	admissionsSend: z.coerce.date().optional(),
	hackathonStartDate: z.coerce.date(),
	scanActions: z.array(z.string()),
	submitTemplate: z.string(),
	acceptTemplate: z.string(),
	confirmTemplate: z.string(),
	declineTemplate: z.string(),
	rejectTemplate: z.string(),
	waitlistTemplate: z.string(),
	timezone: z.string()
});

const DEFAULT_SETTINGS = {
	applicationOpen: new Date(),
	applicationDeadline: new Date(),
	RSVPDeadline: new Date(),
	admissionsSend: null,
	hackathonStartDate: new Date(),
	scanActions: ['Check-In'],
	submitTemplate: 'Hi {{name}}, your application has been submitted!',
	acceptTemplate: 'Hi {{name}}, you have been accepted!',
	confirmTemplate: 'Hi {{name}}, your RSVP has been confirmed!',
	declineTemplate: 'Hi {{name}}, your spot has been declined.',
	rejectTemplate: 'Hi {{name}}, we regret to inform you that your application was not accepted.',
	waitlistTemplate: 'Hi {{name}}, you have been added to the waitlist.',
	timezone: 'America/Chicago'
};

export const settingsRouter = router({
	get: authedProcedure.query(async ({ ctx }) => {
		const settings = await ctx.prisma.settings.findFirst();
		return settings ?? DEFAULT_SETTINGS;
	}),

	update: adminProcedure.input(settingsInput).mutation(async ({ ctx, input }) => {
		const existing = await ctx.prisma.settings.findFirst();
		if (existing) {
			return ctx.prisma.settings.update({ where: { id: existing.id }, data: input });
		}
		return ctx.prisma.settings.create({ data: input });
	})
});
