/**
 * Scenario 3 — Hackathon Start
 *
 * The morning of the event: decisions released, RSVP window closed, attendees
 * arriving. Staff are a mix of confirmed and already checked in.
 *
 * Hacker distribution (total weight 14):
 *   hacker1-5    CONFIRMED  — said yes, not yet scanned
 *   hacker6-8    CHECKED_IN — already through the door
 *   hacker9-10   APPLIED + ACCEPTED — accepted, never RSVPd
 *   hacker11     DECLINED   — accepted but said no
 *   hacker12-13  REJECTED
 *   hacker14     WAITLISTED
 *
 * Run: npm run db:seed:event
 * Add SEED_PRUNE=1 to also remove any @yopmail.com accounts not generated here.
 */

import 'dotenv/config';
import { Role, UserStatus, DecisionStatus } from '../src/lib/generated/prisma/client';
import {
	assertSafeToSeed,
	createPrismaClient,
	seedQuestions,
	seedSettings,
	SEED_WINDOWS
} from './seedShared';
import {
	generateUsers,
	pruneUnmanagedUsers,
	seedUsers,
	summarize,
	type RolePlan,
	type StatePlan
} from './seedUsers';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
	throw new Error('DATABASE_URL is required for seeding');
}

const prisma = createPrismaClient(connectionString);

/**
 * Ordered so the first accounts in each email range land in the most useful states:
 * hacker1-5 are always CONFIRMED and hacker6-8 always CHECKED_IN.
 *
 * Weight breakdown (total 14): ~36% CONFIRMED, ~21% CHECKED_IN, ~14%
 * APPLIED+ACCEPTED (RSVP window closed without a response), ~7% DECLINED,
 * ~14% REJECTED, ~7% WAITLISTED.
 */
const HACKER_STATES: StatePlan[] = [
	{
		status: UserStatus.CONFIRMED,
		pendingDecision: DecisionStatus.ACCEPTED,
		activeDecision: DecisionStatus.ACCEPTED,
		weight: 5
	},
	{
		status: UserStatus.CHECKED_IN,
		pendingDecision: DecisionStatus.ACCEPTED,
		activeDecision: DecisionStatus.ACCEPTED,
		weight: 3
	},
	// Accepted, never RSVP'd; the RSVP window expired.
	{
		status: UserStatus.APPLIED,
		pendingDecision: DecisionStatus.ACCEPTED,
		activeDecision: DecisionStatus.ACCEPTED,
		weight: 2
	},
	{
		status: UserStatus.DECLINED,
		pendingDecision: DecisionStatus.ACCEPTED,
		activeDecision: DecisionStatus.ACCEPTED,
		weight: 1
	},
	{
		status: UserStatus.APPLIED,
		pendingDecision: DecisionStatus.REJECTED,
		activeDecision: DecisionStatus.REJECTED,
		weight: 2
	},
	{
		status: UserStatus.APPLIED,
		pendingDecision: DecisionStatus.WAITLISTED,
		activeDecision: DecisionStatus.WAITLISTED,
		weight: 1
	}
];

/** Staff are either confirmed or already checked in as the event kicks off. */
const STAFF_STATES: StatePlan[] = [
	{
		status: UserStatus.CONFIRMED,
		pendingDecision: DecisionStatus.ACCEPTED,
		activeDecision: DecisionStatus.ACCEPTED,
		weight: 2
	},
	{
		status: UserStatus.CHECKED_IN,
		pendingDecision: DecisionStatus.ACCEPTED,
		activeDecision: DecisionStatus.ACCEPTED,
		weight: 3
	}
];

/** Admins and organizers are internal staff who never go through admissions. */
const INTERNAL_STATES: StatePlan[] = [{ status: UserStatus.CREATED, weight: 1 }];

const ROLE_PLANS: RolePlan[] = [
	{
		role: Role.HACKER,
		prefix: 'hacker',
		envKey: 'SEED_HACKERS',
		defaultCount: 120,
		states: HACKER_STATES,
		academic: true
	},
	{
		role: Role.ADMIN,
		prefix: 'admin',
		envKey: 'SEED_ADMINS',
		defaultCount: 5,
		states: INTERNAL_STATES,
		academic: false
	},
	{
		role: Role.ORGANIZER,
		prefix: 'organizer',
		envKey: 'SEED_ORGANIZERS',
		defaultCount: 8,
		states: INTERNAL_STATES,
		academic: false
	},
	{
		role: Role.JUDGE,
		prefix: 'judge',
		envKey: 'SEED_JUDGES',
		defaultCount: 10,
		states: STAFF_STATES,
		academic: false
	},
	{
		role: Role.MENTOR,
		prefix: 'mentor',
		envKey: 'SEED_MENTORS',
		defaultCount: 14,
		states: STAFF_STATES,
		academic: false
	},
	{
		role: Role.VOLUNTEER,
		prefix: 'volunteer',
		envKey: 'SEED_VOLUNTEERS',
		defaultCount: 14,
		states: STAFF_STATES,
		academic: false
	}
];

async function main() {
	assertSafeToSeed(connectionString);

	console.log('Scenario 3 — Hackathon Start\n');
	await seedQuestions(prisma);
	await seedSettings(prisma, SEED_WINDOWS.event);

	if (process.env.SEED_PRUNE === '1') {
		const pruned = await pruneUnmanagedUsers(prisma, ROLE_PLANS);
		console.log(`\nPruned ${pruned} unmanaged @yopmail.com account(s).`);
	}

	console.log('\nSeeding test accounts...');
	const { users, responses } = await seedUsers(prisma, ROLE_PLANS, { flush: true });
	console.log(summarize(generateUsers(ROLE_PLANS), ROLE_PLANS).join('\n'));
	console.log(`\n  ${users.length} accounts, ${responses} application responses.`);

	console.log('\nDone. Log in at /login with any address above.');
	console.log('  admin1@yopmail.com   — full admin (use to scan attendees)');
	console.log('  hacker1@yopmail.com  — CONFIRMED (ready to check in)');
	console.log('  hacker2@yopmail.com  — CONFIRMED');
	console.log('  hacker3@yopmail.com  — CONFIRMED');
	console.log('  hacker4@yopmail.com  — CONFIRMED');
	console.log('  hacker5@yopmail.com  — CONFIRMED');
	console.log('  hacker6@yopmail.com  — CHECKED_IN (already scanned)');
	console.log('  hacker7@yopmail.com  — CHECKED_IN');
	console.log('  hacker8@yopmail.com  — CHECKED_IN');
}

main()
	.catch((e: unknown) => {
		console.error(e);
		process.exit(1);
	})
	.finally(() => prisma.$disconnect());
