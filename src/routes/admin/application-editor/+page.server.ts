import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createContext } from '$lib/server/trpc/context';
import { appRouter } from '$lib/server/trpc/router';
import { Role, QuestionType } from '$lib/generated/prisma/client';

type QuestionInput = {
	id: string;
	title: string;
	type: QuestionType;
	order: number;
	required: boolean;
	targetRole: Role[];
	placeholder?: string;
	options: string[];
	min?: number;
	max?: number;
	regex?: string;
	linkedField?: string;
};

export const load: PageServerLoad = async (event) => {
	const ctx = await createContext(event);
	const caller = appRouter.createCaller(ctx);

	const questions = await caller.questions.listAll();

	return { questions };
};

export const actions: Actions = {
	save: async (event) => {
		const ctx = await createContext(event);
		const caller = appRouter.createCaller(ctx);

		const formData = await event.request.formData();
		const raw = formData.get('changes');

		if (!raw || typeof raw !== 'string') {
			return fail(400, { error: 'Missing changes payload' });
		}

		let changes: {
			added: Array<Record<string, unknown>>;
			modified: Array<{ id: string } & Record<string, unknown>>;
			deleted: Array<{ id: string }>;
			reordered: Array<{ id: string; order: number }>;
		};

		try {
			changes = JSON.parse(raw);
		} catch {
			return fail(400, { error: 'Invalid changes payload' });
		}

		try {
			await caller.questions.change({
				deleted: changes.deleted,
				modified: changes.modified as Array<QuestionInput>,
				added: changes.added as Array<QuestionInput>,
				reordered: changes.reordered
			});
		} catch (e) {
			console.error('Failed to save question changes:', e);
			return fail(500, { error: 'Failed to save changes. Please try again.' });
		}

		return { success: true };
	}
};
