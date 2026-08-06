import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '$lib/generated/prisma/client';
import { UserStatus, DecisionStatus, QuestionType, Role } from '$lib/generated/prisma/client';
import {
	createTestCaller,
	hackerUser,
	appliedHacker,
	acceptedHacker,
	confirmedHacker,
	mockSettings
} from '../test-utils';

vi.mock('$lib/server/db', async () => {
	const { mockDeep } = await import('vitest-mock-extended');
	return { prisma: mockDeep<PrismaClient>() };
});

vi.mock('$lib/server/email', () => ({
	sendTemplatedEmail: vi.fn().mockResolvedValue(undefined)
}));

const { prisma } = await import('$lib/server/db');
const db = prisma as DeepMockProxy<PrismaClient>;
const { sendTemplatedEmail } = await import('$lib/server/email');

beforeEach(() => {
	mockReset(db);
	vi.mocked(sendTemplatedEmail).mockClear();
});

const response = {
	id: 'resp-1',
	userId: hackerUser.uid,
	questionId: 'q-1',
	value: 'My answer',
	createdAt: new Date('2024-01-01'),
	question: {
		id: 'q-1',
		title: 'Name',
		type: QuestionType.SHORT_TEXT,
		order: 0,
		required: true,
		targetRole: [],
		placeholder: null,
		options: [],
		min: null,
		max: null,
		regex: null
	}
};

const DAY = 24 * 60 * 60 * 1000;
const ago = (ms: number) => new Date(Date.now() - ms);
const ahead = (ms: number) => new Date(Date.now() + ms);

/**
 * `mockSettings` is pinned to 2024 dates, so every window it defines is already behind
 * us — which is exactly what the guards now reject. Anything asserting a *successful*
 * write re-bases the three dates onto the current clock through these, so the tests keep
 * testing what they were written to test rather than the deadline.
 */
const openWindow = {
	...mockSettings,
	applicationOpen: ago(DAY),
	applicationDeadline: ahead(DAY),
	RSVPDeadline: ahead(DAY)
};
const notYetOpen = {
	...openWindow,
	applicationOpen: ahead(DAY),
	applicationDeadline: ahead(2 * DAY)
};
const closed = { ...openWindow, applicationOpen: ago(2 * DAY), applicationDeadline: ago(DAY) };
const rsvpClosed = { ...openWindow, RSVPDeadline: ago(DAY) };

const requiredQuestion = {
	id: 'q-1',
	title: 'Name',
	type: QuestionType.SHORT_TEXT,
	order: 0,
	required: true,
	targetRole: [] as Role[],
	placeholder: null,
	options: [] as string[],
	min: null,
	max: null,
	regex: null
};

describe('application.getMyResponses', () => {
	it('returns current user responses with questions', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.applicationResponse.findMany.mockResolvedValue([response] as never);
		const result = await caller.application.getMyResponses();
		expect(result).toEqual([response]);
		expect(db.applicationResponse.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { userId: hackerUser.uid },
				include: { question: true }
			})
		);
	});

	it('throws UNAUTHORIZED when not logged in', async () => {
		const caller = createTestCaller(db, null);
		await expect(caller.application.getMyResponses()).rejects.toMatchObject({
			code: 'UNAUTHORIZED'
		});
	});
});

describe('application.save', () => {
	it('upserts on userId+questionId key', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue(hackerUser as never);
		db.settings.findFirst.mockResolvedValue(openWindow);
		db.question.findUnique.mockResolvedValue({
			linkedField: null,
			targetRole: [],
			type: QuestionType.SHORT_TEXT,
			options: [],
			min: null,
			max: null,
			regex: null
		} as never);
		db.applicationResponse.upsert.mockResolvedValue(response as never);

		await caller.application.save({ questionId: 'q-1', value: 'My answer' });

		expect(db.applicationResponse.upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { userId_questionId: { userId: hackerUser.uid, questionId: 'q-1' } },
				update: { value: 'My answer' },
				create: { userId: hackerUser.uid, questionId: 'q-1', value: 'My answer' }
			})
		);
	});

	it('saves when no settings row exists yet', async () => {
		// Fresh install: no window is configured, so the gate stays open rather than
		// locking applicants out of an event nobody has set up.
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue(hackerUser as never);
		db.settings.findFirst.mockResolvedValue(null);
		db.question.findUnique.mockResolvedValue({
			linkedField: null,
			targetRole: [],
			type: QuestionType.SHORT_TEXT,
			options: [],
			min: null,
			max: null,
			regex: null
		} as never);
		db.applicationResponse.upsert.mockResolvedValue(response as never);

		await caller.application.save({ questionId: 'q-1', value: 'My answer' });

		expect(db.applicationResponse.upsert).toHaveBeenCalled();
	});

	it('throws NOT_FOUND when the question does not exist', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue(hackerUser as never);
		db.settings.findFirst.mockResolvedValue(openWindow);
		db.question.findUnique.mockResolvedValue(null as never);

		await expect(
			caller.application.save({ questionId: 'ghost', value: 'x' })
		).rejects.toMatchObject({ code: 'NOT_FOUND' });
		expect(db.applicationResponse.upsert).not.toHaveBeenCalled();
	});

	it('forbids answering a question aimed at a different audience', async () => {
		// hackerUser is [HACKER]; a JUDGE-only question was never asked of them.
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue(hackerUser as never);
		db.settings.findFirst.mockResolvedValue(openWindow);
		db.question.findUnique.mockResolvedValue({
			linkedField: null,
			targetRole: [Role.JUDGE],
			type: QuestionType.SHORT_TEXT,
			options: [],
			min: null,
			max: null,
			regex: null
		} as never);

		await expect(caller.application.save({ questionId: 'q-1', value: 'x' })).rejects.toMatchObject({
			code: 'FORBIDDEN'
		});
		expect(db.applicationResponse.upsert).not.toHaveBeenCalled();
	});

	it('rejects a non-numeric answer to a NUMBER question', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue(hackerUser as never);
		db.settings.findFirst.mockResolvedValue(openWindow);
		db.question.findUnique.mockResolvedValue({
			linkedField: null,
			targetRole: [],
			type: QuestionType.NUMBER,
			options: [],
			min: null,
			max: null,
			regex: null
		} as never);

		await expect(
			caller.application.save({ questionId: 'q-1', value: 'potato' })
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		expect(db.applicationResponse.upsert).not.toHaveBeenCalled();
	});

	it('rejects a dropdown answer that is not one of the offered options', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue(hackerUser as never);
		db.settings.findFirst.mockResolvedValue(openWindow);
		db.question.findUnique.mockResolvedValue({
			linkedField: null,
			targetRole: [],
			type: QuestionType.DROPDOWN,
			options: ['A', 'B'],
			min: null,
			max: null,
			regex: null
		} as never);

		await expect(caller.application.save({ questionId: 'q-1', value: 'C' })).rejects.toMatchObject({
			code: 'BAD_REQUEST'
		});
		expect(db.applicationResponse.upsert).not.toHaveBeenCalled();
	});

	it('writes through to the linked user field before upserting', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue(hackerUser as never);
		db.settings.findFirst.mockResolvedValue(openWindow);
		db.question.findUnique.mockResolvedValue({
			linkedField: 'name',
			targetRole: [],
			type: QuestionType.SHORT_TEXT,
			options: [],
			min: null,
			max: null,
			regex: null
		} as never);
		db.user.update.mockResolvedValue(hackerUser as never);
		db.applicationResponse.upsert.mockResolvedValue(response as never);

		await caller.application.save({ questionId: 'q-1', value: 'New Name' });

		expect(db.user.update).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { uid: hackerUser.uid },
				data: { name: 'New Name' }
			})
		);
	});

	it('rejects a save before applications open', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue(hackerUser as never);
		db.settings.findFirst.mockResolvedValue(notYetOpen);

		await expect(caller.application.save({ questionId: 'q-1', value: 'x' })).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: expect.stringContaining("don't open until")
		});
		expect(db.applicationResponse.upsert).not.toHaveBeenCalled();
	});

	it('rejects a save after the deadline', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue(hackerUser as never);
		db.settings.findFirst.mockResolvedValue(closed);

		await expect(caller.application.save({ questionId: 'q-1', value: 'x' })).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: expect.stringContaining('Applications closed on')
		});
		expect(db.applicationResponse.upsert).not.toHaveBeenCalled();
	});

	it('rejects a save once the application has been submitted', async () => {
		// The answers behind a submitted application are what an admin decides on, and an
		// upsert here leaves no audit entry — an edit at this point would be invisible.
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue(appliedHacker as never);
		db.settings.findFirst.mockResolvedValue(openWindow);

		await expect(caller.application.save({ questionId: 'q-1', value: 'x' })).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: expect.stringContaining('no longer be edited')
		});
		expect(db.applicationResponse.upsert).not.toHaveBeenCalled();
	});

	it('rejects a save from a user who has already been decided on', async () => {
		const caller = createTestCaller(db, acceptedHacker);
		db.user.findUniqueOrThrow.mockResolvedValue(acceptedHacker as never);
		db.settings.findFirst.mockResolvedValue(openWindow);

		await expect(caller.application.save({ questionId: 'q-1', value: 'x' })).rejects.toMatchObject({
			code: 'BAD_REQUEST'
		});
		expect(db.applicationResponse.upsert).not.toHaveBeenCalled();
	});

	it('does not write through to the linked user field when rejected', async () => {
		// The linked-field write happens before the upsert, so a guard that ran too late
		// would still let a rejected save change the user's name or university.
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue(appliedHacker as never);
		db.settings.findFirst.mockResolvedValue(openWindow);

		await expect(
			caller.application.save({ questionId: 'q-1', value: 'New Name' })
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		expect(db.user.update).not.toHaveBeenCalled();
	});
});

describe('application.rsvp', () => {
	it('sends the confirm template on success', async () => {
		const caller = createTestCaller(db, acceptedHacker);
		db.user.findUniqueOrThrow.mockResolvedValue(acceptedHacker as never);
		db.user.update.mockResolvedValue({
			...acceptedHacker,
			status: UserStatus.CONFIRMED
		} as never);
		db.settings.findFirst.mockResolvedValue(openWindow);

		await caller.application.rsvp();

		expect(sendTemplatedEmail).toHaveBeenCalledWith(
			acceptedHacker.email,
			{ subject: mockSettings.confirmSubject, body: mockSettings.confirmTemplate },
			expect.objectContaining({ name: acceptedHacker.name })
		);
	});

	it('still confirms when the email send fails', async () => {
		const caller = createTestCaller(db, acceptedHacker);
		db.user.findUniqueOrThrow.mockResolvedValue(acceptedHacker as never);
		db.user.update.mockResolvedValue({
			...acceptedHacker,
			status: UserStatus.CONFIRMED
		} as never);
		db.settings.findFirst.mockResolvedValue(openWindow);
		vi.mocked(sendTemplatedEmail).mockRejectedValueOnce(new Error('smtp down'));

		const result = await caller.application.rsvp();

		expect(result.status).toBe(UserStatus.CONFIRMED);
	});

	it('rejects an RSVP after the RSVP deadline', async () => {
		const caller = createTestCaller(db, acceptedHacker);
		db.user.findUniqueOrThrow.mockResolvedValue(acceptedHacker as never);
		db.settings.findFirst.mockResolvedValue(rsvpClosed);

		await expect(caller.application.rsvp()).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: expect.stringContaining('RSVP deadline passed on')
		});
		expect(db.user.update).not.toHaveBeenCalled();
	});

	it('reports the already-RSVPd state ahead of a passed deadline', async () => {
		// Someone already CONFIRMED gains nothing from being told about a deadline that no
		// longer concerns them.
		const caller = createTestCaller(db, confirmedHacker);
		db.user.findUniqueOrThrow.mockResolvedValue(confirmedHacker as never);
		db.settings.findFirst.mockResolvedValue(rsvpClosed);

		await expect(caller.application.rsvp()).rejects.toMatchObject({
			message: expect.stringContaining('already')
		});
	});

	it('refuses to RSVP a checked-in attendee', async () => {
		const caller = createTestCaller(db, acceptedHacker);
		db.user.findUniqueOrThrow.mockResolvedValue({
			...acceptedHacker,
			status: UserStatus.CHECKED_IN
		} as never);
		db.settings.findFirst.mockResolvedValue(openWindow);

		await expect(caller.application.rsvp()).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: expect.stringContaining('already checked in')
		});
		expect(db.user.update).not.toHaveBeenCalled();
	});

	it('refuses to re-RSVP after the spot was released by declining', async () => {
		const caller = createTestCaller(db, acceptedHacker);
		db.user.findUniqueOrThrow.mockResolvedValue({
			...acceptedHacker,
			status: UserStatus.DECLINED
		} as never);
		db.settings.findFirst.mockResolvedValue(openWindow);

		await expect(caller.application.rsvp()).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: expect.stringContaining('released your spot')
		});
		expect(db.user.update).not.toHaveBeenCalled();
	});

	it('allows an RSVP when no settings row exists yet', async () => {
		const caller = createTestCaller(db, acceptedHacker);
		db.user.findUniqueOrThrow.mockResolvedValue(acceptedHacker as never);
		db.user.update.mockResolvedValue({
			...acceptedHacker,
			status: UserStatus.CONFIRMED
		} as never);
		db.settings.findFirst.mockResolvedValue(null);

		const result = await caller.application.rsvp();

		expect(result.status).toBe(UserStatus.CONFIRMED);
	});
});

describe('application.rsvpDecline', () => {
	it('sends the decline template on success', async () => {
		const caller = createTestCaller(db, acceptedHacker);
		db.user.findUniqueOrThrow.mockResolvedValue(acceptedHacker as never);
		db.user.update.mockResolvedValue({
			...acceptedHacker,
			status: UserStatus.DECLINED
		} as never);
		db.settings.findFirst.mockResolvedValue(openWindow);

		await caller.application.rsvpDecline();

		expect(sendTemplatedEmail).toHaveBeenCalledWith(
			acceptedHacker.email,
			{ subject: mockSettings.declineSubject, body: mockSettings.declineTemplate },
			expect.objectContaining({ name: acceptedHacker.name })
		);
	});

	it('still accepts a decline after the RSVP deadline', async () => {
		// Deliberate asymmetry with `rsvp`: the deadline freezes the confirmed headcount,
		// and a decline only shrinks it. Refusing a late one leaves a spot held by someone
		// who has just told us they aren't coming.
		const caller = createTestCaller(db, acceptedHacker);
		db.user.findUniqueOrThrow.mockResolvedValue(acceptedHacker as never);
		db.user.update.mockResolvedValue({
			...acceptedHacker,
			status: UserStatus.DECLINED
		} as never);
		db.settings.findFirst.mockResolvedValue(rsvpClosed);

		const result = await caller.application.rsvpDecline();

		expect(result.status).toBe(UserStatus.DECLINED);
	});

	it('sends nothing when no settings row exists', async () => {
		const caller = createTestCaller(db, acceptedHacker);
		db.user.findUniqueOrThrow.mockResolvedValue(acceptedHacker as never);
		db.user.update.mockResolvedValue({
			...acceptedHacker,
			status: UserStatus.DECLINED
		} as never);
		db.settings.findFirst.mockResolvedValue(null);

		await caller.application.rsvpDecline();

		expect(sendTemplatedEmail).not.toHaveBeenCalled();
	});

	it('refuses to decline a checked-in attendee', async () => {
		// They are physically here — declining would erase the check-in with no audit trail.
		const caller = createTestCaller(db, acceptedHacker);
		db.user.findUniqueOrThrow.mockResolvedValue({
			...acceptedHacker,
			status: UserStatus.CHECKED_IN
		} as never);
		db.settings.findFirst.mockResolvedValue(openWindow);

		await expect(caller.application.rsvpDecline()).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: expect.stringContaining('already checked in')
		});
		expect(db.user.update).not.toHaveBeenCalled();
	});
});

describe('application.submit', () => {
	it('sets status to APPLIED on success', async () => {
		const caller = createTestCaller(db, hackerUser);
		// findUniqueOrThrow is called twice: once at the start to load the user (must be
		// CREATED to pass the guard) and again after the compare-and-swap to re-read it.
		db.user.findUniqueOrThrow
			.mockResolvedValueOnce(hackerUser as never)
			.mockResolvedValue({ ...hackerUser, status: UserStatus.APPLIED } as never);
		db.question.findMany.mockResolvedValue([] as never);
		db.applicationResponse.findMany.mockResolvedValue([] as never);
		db.blacklist.findUnique.mockResolvedValue(null as never);
		db.user.updateMany.mockResolvedValue({ count: 1 } as never);
		db.settings.findFirst.mockResolvedValue(openWindow);

		const result = await caller.application.submit();
		expect(result.status).toBe(UserStatus.APPLIED);
		expect(db.user.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { uid: hackerUser.uid, status: UserStatus.CREATED },
				data: expect.objectContaining({
					status: UserStatus.APPLIED,
					role: hackerUser.role
				})
			})
		);
	});

	it('rejects a concurrent double-submit via the compare-and-swap', async () => {
		// The status guard read CREATED, but a racing submit already flipped the row, so the
		// gated updateMany matches nothing and this caller is told it's already in.
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue(hackerUser as never);
		db.question.findMany.mockResolvedValue([] as never);
		db.applicationResponse.findMany.mockResolvedValue([] as never);
		db.blacklist.findUnique.mockResolvedValue(null as never);
		db.user.updateMany.mockResolvedValue({ count: 0 } as never);
		db.settings.findFirst.mockResolvedValue(openWindow);

		await expect(caller.application.submit()).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: expect.stringContaining('already been submitted')
		});
		expect(sendTemplatedEmail).not.toHaveBeenCalled();
	});

	it('submits when no settings row exists yet', async () => {
		// Fresh install — no configured window, so nothing to be outside of.
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow
			.mockResolvedValueOnce(hackerUser as never)
			.mockResolvedValue({ ...hackerUser, status: UserStatus.APPLIED } as never);
		db.question.findMany.mockResolvedValue([] as never);
		db.applicationResponse.findMany.mockResolvedValue([] as never);
		db.blacklist.findUnique.mockResolvedValue(null as never);
		db.user.updateMany.mockResolvedValue({ count: 1 } as never);
		db.settings.findFirst.mockResolvedValue(null);

		const result = await caller.application.submit();
		expect(result.status).toBe(UserStatus.APPLIED);
	});

	it('rejects a submission before applications open', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue(hackerUser as never);
		db.settings.findFirst.mockResolvedValue(notYetOpen);

		await expect(caller.application.submit()).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: expect.stringContaining("don't open until")
		});
		expect(db.user.updateMany).not.toHaveBeenCalled();
	});

	it('rejects a submission after the deadline', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue(hackerUser as never);
		db.settings.findFirst.mockResolvedValue(closed);

		await expect(caller.application.submit()).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: expect.stringContaining('Applications closed on')
		});
		expect(db.user.updateMany).not.toHaveBeenCalled();
		expect(sendTemplatedEmail).not.toHaveBeenCalled();
	});

	it('throws BAD_REQUEST if already submitted', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue(appliedHacker as never);
		db.settings.findFirst.mockResolvedValue(openWindow);

		await expect(caller.application.submit()).rejects.toMatchObject({ code: 'BAD_REQUEST' });
	});

	it('throws BAD_REQUEST if required questions are unanswered', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue(hackerUser as never);
		db.settings.findFirst.mockResolvedValue(openWindow);
		db.question.findMany.mockResolvedValue([requiredQuestion] as never);
		db.applicationResponse.findMany.mockResolvedValue([] as never);

		await expect(caller.application.submit()).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: expect.stringContaining('Name')
		});
	});

	it('treats a required question answered only with whitespace as unanswered', async () => {
		// A response row exists for the required question, but its value is blank — autosave
		// fires on the keystroke that clears the field too, so row existence alone must not
		// satisfy the requirement.
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValue(hackerUser as never);
		db.settings.findFirst.mockResolvedValue(openWindow);
		db.question.findMany.mockResolvedValue([requiredQuestion] as never);
		db.applicationResponse.findMany.mockResolvedValue([
			{
				id: 'resp-1',
				userId: hackerUser.uid,
				questionId: 'q-1',
				value: '   ',
				createdAt: new Date('2024-01-01')
			}
		] as never);

		await expect(caller.application.submit()).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: expect.stringContaining('Name')
		});
		expect(db.user.updateMany).not.toHaveBeenCalled();
	});

	it('accepts a required question that has a non-blank answer', async () => {
		// The flip side of the blank-answer rule: a real answer counts, so submission goes
		// through even though the question is required.
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow
			.mockResolvedValueOnce(hackerUser as never)
			.mockResolvedValue({ ...hackerUser, status: UserStatus.APPLIED } as never);
		db.settings.findFirst.mockResolvedValue(openWindow);
		db.question.findMany.mockResolvedValue([requiredQuestion] as never);
		db.applicationResponse.findMany.mockResolvedValue([
			{
				id: 'resp-1',
				userId: hackerUser.uid,
				questionId: 'q-1',
				value: 'Hacker User',
				createdAt: new Date('2024-01-01')
			}
		] as never);
		db.blacklist.findUnique.mockResolvedValue(null as never);
		db.user.updateMany.mockResolvedValue({ count: 1 } as never);

		const result = await caller.application.submit();
		expect(result.status).toBe(UserStatus.APPLIED);
	});

	it('auto-sets pendingDecision=REJECTED for a blacklisted email', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow.mockResolvedValueOnce(hackerUser as never).mockResolvedValue({
			...hackerUser,
			status: UserStatus.APPLIED,
			pendingDecision: DecisionStatus.REJECTED
		} as never);
		db.question.findMany.mockResolvedValue([] as never);
		db.applicationResponse.findMany.mockResolvedValue([] as never);
		db.blacklist.findUnique.mockResolvedValue({ id: 'bl-1' } as never);
		db.user.updateMany.mockResolvedValue({ count: 1 } as never);
		db.settings.findFirst.mockResolvedValue(openWindow);

		await caller.application.submit();

		expect(db.user.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { uid: hackerUser.uid, status: UserStatus.CREATED },
				data: expect.objectContaining({ pendingDecision: DecisionStatus.REJECTED })
			})
		);
	});

	it('looks the email up in its normalized form', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow
			.mockResolvedValueOnce({
				...hackerUser,
				email: '  Hacker@Example.COM '
			} as never)
			.mockResolvedValue({ ...hackerUser, status: UserStatus.APPLIED } as never);
		db.question.findMany.mockResolvedValue([] as never);
		db.applicationResponse.findMany.mockResolvedValue([] as never);
		db.blacklist.findUnique.mockResolvedValue(null as never);
		db.user.updateMany.mockResolvedValue({ count: 1 } as never);
		db.settings.findFirst.mockResolvedValue(openWindow);

		await caller.application.submit();

		expect(db.blacklist.findUnique).toHaveBeenCalledWith(
			expect.objectContaining({ where: { email: 'hacker@example.com' } })
		);
	});

	it('does not auto-reject on a name match, which only flags at review time', async () => {
		// A blacklisted name is matched tolerantly enough to catch misspellings, so it must
		// never reach a decision on its own -- `admissions.list` surfaces it to a human.
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow
			.mockResolvedValueOnce(hackerUser as never)
			.mockResolvedValue({ ...hackerUser, status: UserStatus.APPLIED } as never);
		db.question.findMany.mockResolvedValue([] as never);
		db.applicationResponse.findMany.mockResolvedValue([] as never);
		db.blacklist.findUnique.mockResolvedValue(null as never);
		db.user.updateMany.mockResolvedValue({ count: 1 } as never);
		db.settings.findFirst.mockResolvedValue(openWindow);

		await caller.application.submit();

		const updateArg = db.user.updateMany.mock.calls[0]?.[0];
		expect(updateArg?.data).not.toHaveProperty('pendingDecision');
	});

	it('calls sendTemplatedEmail on success when submitTemplate is set', async () => {
		const caller = createTestCaller(db, hackerUser);
		db.user.findUniqueOrThrow
			.mockResolvedValueOnce(hackerUser as never)
			.mockResolvedValue({ ...hackerUser, status: UserStatus.APPLIED } as never);
		db.question.findMany.mockResolvedValue([] as never);
		db.applicationResponse.findMany.mockResolvedValue([] as never);
		db.blacklist.findUnique.mockResolvedValue(null as never);
		db.user.updateMany.mockResolvedValue({ count: 1 } as never);
		db.settings.findFirst.mockResolvedValue(openWindow);

		await caller.application.submit();

		expect(sendTemplatedEmail).toHaveBeenCalledWith(
			hackerUser.email,
			{ subject: mockSettings.submitSubject, body: mockSettings.submitTemplate },
			expect.objectContaining({ name: hackerUser.name })
		);
	});
});
