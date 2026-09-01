import type { Mock } from 'vitest';
import { createCallerFactory } from '../init';
import { appRouter } from '../router';
import type { DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient, User } from '$lib/generated/prisma/client';
import { Role, UserStatus, DecisionStatus } from '$lib/generated/prisma/client';

const factory = createCallerFactory(appRouter);

export function createTestCaller(prisma: DeepMockProxy<PrismaClient>, user: User | null = null) {
	return factory({ prisma: prisma as unknown as PrismaClient, user });
}

/**
 * Narrows a mocked `groupBy` to a plain vitest mock. Prisma 7 types `groupBy` as an
 * overloaded generic keyed on the `by` tuple, which `DeepMockProxy` can't see through.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the point is to erase an unspellable type.
export function mockGroupBy(method: unknown): Mock<(...args: any[]) => any> {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return method as Mock<(...args: any[]) => any>;
}

export const adminUser: User = {
	uid: 'admin-uid',
	name: 'Admin User',
	email: 'admin@example.com',
	university: null,
	year: null,
	role: Role.ADMIN,
	status: UserStatus.CREATED,
	pendingDecision: null,
	activeDecision: null,
	teamId: null,
	groupId: null,
	createdAt: new Date('2024-01-01'),
	claimedBy: null,
	claimedAt: null,
	decidedBy: null,
	decidedAt: null,
	score: null,
	scoreDelta: null,
	notes: null,
	scoredBy: null,
	scoredAt: null
};

/** A second admin, for exercising review-lock contention between two reviewers. */
export const adminUser2: User = {
	...adminUser,
	uid: 'admin2-uid',
	name: 'Second Admin',
	email: 'admin2@example.com'
};

export const organizerUser: User = {
	uid: 'organizer-uid',
	name: 'Organizer User',
	email: 'organizer@example.com',
	university: null,
	year: null,
	role: Role.ORGANIZER,
	status: UserStatus.CREATED,
	pendingDecision: null,
	activeDecision: null,
	teamId: null,
	groupId: null,
	createdAt: new Date('2024-01-01'),
	claimedBy: null,
	claimedAt: null,
	decidedBy: null,
	decidedAt: null,
	score: null,
	scoreDelta: null,
	notes: null,
	scoredBy: null,
	scoredAt: null
};

export const hackerUser: User = {
	uid: 'hacker-uid',
	name: 'Hacker User',
	email: 'hacker@example.com',
	university: 'University of Texas at Austin',
	year: 'Junior',
	role: Role.HACKER,
	status: UserStatus.CREATED,
	pendingDecision: null,
	activeDecision: null,
	teamId: null,
	groupId: null,
	createdAt: new Date('2024-01-01'),
	claimedBy: null,
	claimedAt: null,
	decidedBy: null,
	decidedAt: null,
	score: null,
	scoreDelta: null,
	notes: null,
	scoredBy: null,
	scoredAt: null
};

/** An applicant currently locked by `adminUser2`. Override claimedAt per test. */
export const claimedHacker: User = {
	...hackerUser,
	uid: 'claimed-uid',
	email: 'claimed@example.com',
	claimedBy: adminUser2.uid,
	claimedAt: new Date('2024-01-01')
};

export const appliedHacker: User = {
	...hackerUser,
	uid: 'applied-uid',
	email: 'applied@example.com',
	status: UserStatus.APPLIED
};

export const acceptedHacker: User = {
	...hackerUser,
	uid: 'accepted-uid',
	email: 'accepted@example.com',
	status: UserStatus.APPLIED,
	activeDecision: DecisionStatus.ACCEPTED
};

export const confirmedHacker: User = {
	...hackerUser,
	uid: 'confirmed-uid',
	email: 'confirmed@example.com',
	status: UserStatus.CONFIRMED,
	activeDecision: DecisionStatus.ACCEPTED
};

export const waitlistedHacker: User = {
	...hackerUser,
	uid: 'waitlisted-uid',
	email: 'waitlisted@example.com',
	status: UserStatus.APPLIED,
	activeDecision: DecisionStatus.WAITLISTED
};

export const mockSettings = {
	id: 'settings-1',
	applicationOpen: new Date('2024-01-01'),
	applicationDeadline: new Date('2024-03-01'),
	RSVPDeadline: new Date('2024-04-01'),
	admissionsSend: null,
	hackathonStartDate: new Date('2024-04-15'),
	scanActions: ['Check-In'],
	submitTemplate: 'Hi {{name}}, submitted!',
	submitSubject: 'Application received',
	acceptTemplate: 'Hi {{name}}, accepted!',
	acceptSubject: "You're in!",
	confirmTemplate: 'Hi {{name}}, confirmed!',
	confirmSubject: 'RSVP confirmed',
	declineTemplate: 'Hi {{name}}, declined.',
	declineSubject: 'RSVP declined',
	rejectTemplate: 'Hi {{name}}, rejected.',
	rejectSubject: 'Application update',
	waitlistTemplate: 'Hi {{name}}, waitlisted.',
	waitlistSubject: "You're on the waitlist",
	timezone: 'America/Chicago',
	homeState: 'TX'
};
