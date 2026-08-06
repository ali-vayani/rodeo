import { describe, it, expect } from 'vitest';
import { z, ZodError } from 'zod';
import { formatTRPCError } from './init';

/**
 * The formatter is what stands between a hacker and a wall of JSON.
 *
 * tRPC only runs it at the HTTP boundary, so the router tests — which call
 * procedures through `createCallerFactory` — never exercise it. Tested directly
 * against a real `ZodError` rather than a hand-built one, so a zod upgrade that
 * moves `issues` or `flatten` fails here rather than in production.
 */

/** The shape tRPC hands the formatter, reduced to the parts this reads. */
const SHAPE = { message: 'Input validation failed', code: -32600, data: { code: 'BAD_REQUEST' } };

function zodErrorFor(schema: z.ZodType, value: unknown): ZodError {
	const result = schema.safeParse(value);
	if (result.success) throw new Error('expected the schema to reject this value');
	return result.error;
}

describe('formatTRPCError', () => {
	it('replaces the serialized issue array with the issue’s own message', () => {
		const schema = z.object({ email: z.string().email('Enter a valid email address.') });
		const shape = formatTRPCError({
			shape: SHAPE,
			error: { cause: zodErrorFor(schema, { email: 'teammate@' }) }
		});

		expect(shape.message).toBe('Enter a valid email address.');
		// The default message was JSON, which is the whole complaint.
		expect(shape.message).not.toContain('{');
	});

	it('joins every issue so a multi-field form reports all of them', () => {
		const schema = z.object({
			email: z.string().email('Enter a valid email address.'),
			teamName: z.string().min(1, 'Team name cannot be empty.')
		});
		const shape = formatTRPCError({
			shape: SHAPE,
			error: { cause: zodErrorFor(schema, { email: 'nope', teamName: '' }) }
		});

		expect(shape.message).toContain('Enter a valid email address.');
		expect(shape.message).toContain('Team name cannot be empty.');
	});

	it('exposes the field-keyed breakdown for forms that mark up inputs', () => {
		const schema = z.object({ email: z.string().email('Enter a valid email address.') });
		const shape = formatTRPCError({
			shape: SHAPE,
			error: { cause: zodErrorFor(schema, { email: 'teammate@' }) }
		});

		expect(shape.data.zodError).toEqual({ email: ['Enter a valid email address.'] });
		// Whatever tRPC already put on `data` has to survive — the client reads
		// `data.code` to tell a CONFLICT from a generic failure.
		expect(shape.data.code).toBe('BAD_REQUEST');
	});

	it('passes a non-zod error through untouched', () => {
		// A TRPCError thrown by a procedure already carries the sentence it wants
		// shown; rewriting it here would undo every deliberate message in the routers.
		const shape = formatTRPCError({ shape: SHAPE, error: { cause: new Error('connection lost') } });

		expect(shape).toBe(SHAPE);
	});
});
