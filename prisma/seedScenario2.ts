/**
 * Scenario 2 — Applications Closed
 *
 * The deadline has passed and admins have reviewed every application. Every hacker
 * who applied has a pendingDecision, but activeDecision is still null, so nothing has
 * been released to applicants yet. A small share registered but never submitted.
 * Staff are fully confirmed; admins and organizers never go through admissions.
 *
 * Run: npm run db:seed:closed
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
 * Everyone who applied has been reviewed, but activeDecision remains null across the
 * board, so hackers see no decision in their portal yet.
 *
 * Weight breakdown (total 11): ~9% CREATED, ~36% ACCEPTED, ~36% REJECTED,
 * ~18% WAITLISTED, all pending and unreleased.
 */
const HACKER_STATES: StatePlan[] = [
	{ status: UserStatus.CREATED, weight: 1 },
	{ status: UserStatus.APPLIED, pendingDecision: DecisionStatus.ACCEPTED, weight: 4 },
	{ status: UserStatus.APPLIED, pendingDecision: DecisionStatus.REJECTED, weight: 4 },
	{ status: UserStatus.APPLIED, pendingDecision: DecisionStatus.WAITLISTED, weight: 2 }
];

/** All staff confirmed — logistics are locked in ahead of decision release. */
const STAFF_STATES: StatePlan[] = [
	{
		status: UserStatus.CONFIRMED,
		pendingDecision: DecisionStatus.ACCEPTED,
		activeDecision: DecisionStatus.ACCEPTED,
		weight: 1
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

	console.log('Scenario 2 — Applications Closed\n');
	await seedQuestions(prisma);
	await seedSettings(prisma, SEED_WINDOWS.closed);

	if (process.env.SEED_PRUNE === '1') {
		const pruned = await pruneUnmanagedUsers(prisma, ROLE_PLANS);
		console.log(`\nPruned ${pruned} unmanaged @yopmail.com account(s).`);
	}

	console.log('\nSeeding test accounts...');
	const { users, responses } = await seedUsers(prisma, ROLE_PLANS, { flush: true });
	console.log(summarize(generateUsers(ROLE_PLANS), ROLE_PLANS).join('\n'));
	console.log(`\n  ${users.length} accounts, ${responses} application responses.`);

	console.log('\nDone. Log in at /login with any address above.');
	console.log('  admin1@yopmail.com   — full admin (use to release decisions)');
	console.log('  hacker1@yopmail.com  — CREATED (never submitted)');
	console.log('  hacker2@yopmail.com  — APPLIED, pendingDecision=ACCEPTED (unreleased)');
	console.log('  hacker6@yopmail.com  — APPLIED, pendingDecision=REJECTED (unreleased)');
	console.log('  hacker10@yopmail.com — APPLIED, pendingDecision=WAITLISTED (unreleased)');
}

main()
	.catch((e: unknown) => {
		console.error(e);
		process.exit(1);
	})
	.finally(() => prisma.$disconnect());
