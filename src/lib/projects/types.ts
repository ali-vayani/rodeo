import { z } from 'zod';

/** One row of the projects feed. Everything else the feed sends is dropped. */
export const projectSchema = z.object({
	name: z.string().trim().min(1),
	table: z.coerce.number().int().nonnegative(),
	description: z.string().trim().default('')
});

export const projectsFeedSchema = z.array(projectSchema);

export type Project = z.infer<typeof projectSchema>;
