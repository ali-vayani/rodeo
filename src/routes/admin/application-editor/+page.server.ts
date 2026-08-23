import { fail } from '@sveltejs/kit';
import { TRPCError } from '@trpc/server';
import { ZodError } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { createContext } from '$lib/server/trpc/context';
import { appRouter } from '$lib/server/trpc/router';
import type { LinkedField, OptionPreset } from '$lib/generated/prisma/client';
import { Role, QuestionType } from '$lib/generated/prisma/client';

type QuestionInput = {
	id: string;
	title: string;
	type: QuestionType;
	order: number;
	required: boolean;
	targetRole: Role[];
	// Nullable columns: Prisma returns `null`, and the editor posts back what it
	// loaded, so the wire shape has to admit it.
	placeholder?: string | null;
	options: string[];
	min?: number | null;
	max?: number | null;
	regex?: string | null;
	linkedField?: LinkedField | null;
	optionPreset?: OptionPreset | null;
};

/**
 * Turns whatever `questions.change` threw into one sentence the organizer can act on.
 * Only text we author reaches the client; the full error stays in `console.error`.
 *
 * Inputs:
 * - error: unknown — the caught value, usually a ZodError, TRPCError, or Prisma error
 *
 * Outputs:
 * - string — a lowercase clause that completes "Failed to save changes: ..."
 */
function describeSaveFailure(error: unknown): string {
	const zodError =
		error instanceof ZodError
			? error
			: error instanceof TRPCError && error.cause instanceof ZodError
				? error.cause
				: null;

	if (zodError) {
		const issues = zodError.issues.slice(0, 3).map((issue) => {
			const path = issue.path.join('.');
			return path ? `${path}: ${issue.message}` : issue.message;
		});
		const more = zodError.issues.length - issues.length;
		return `some questions were rejected — ${issues.join('; ')}${more > 0 ? ` (and ${more} more)` : ''}`;
	}

	// A TRPCError message is text we wrote (permission denied, not found, …).
	if (error instanceof TRPCError) return error.message;

	// Anything else (Prisma, network) could carry query internals, so name the class of
	// failure only.
	if (error instanceof Error && error.name.startsWith('Prisma')) {
		return 'the database rejected the change';
	}
	return 'an unexpected server error occurred';
}

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
			const isInvalidInput =
				e instanceof ZodError || (e instanceof TRPCError && e.code === 'BAD_REQUEST');
			return fail(isInvalidInput ? 400 : 500, {
				error: `Failed to save changes: ${describeSaveFailure(e)}`
			});
		}

		return { success: true };
	}
};
