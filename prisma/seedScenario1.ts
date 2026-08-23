/**
 * Scenario 1 — Applications Open
 *
 * Right after the application portal goes live. Hackers are a mix of newly registered
 * (CREATED) and submitted (APPLIED + PENDING), with no reviews or decisions yet. Staff
 * are recruited ahead of hacker applications, so they are spread across applied,
 * accepted and confirmed. Admins and organizers never go through admissions.
 *
 * Run: npm run db:seed:open
 * Add SEED_PRUNE=1 to also remove any @yopmail.com accounts not generated here.
 */

import 'dotenv/config';
import { Role, UserStatus, DecisionStatus } from '../src/lib/generated/prisma/client';
import { assertSafeToSeed, createPrismaClient, seedQuestions } from './seedShared';
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
 * ~30% registered but not yet submitted, ~70% submitted and waiting for review.
 * No decisions exist at all — the admissions queue is completely untouched.
 */
const HACKER_STATES: StatePlan[] = [
	{ status: UserStatus.CREATED, weight: 3 },
	{ status: UserStatus.APPLIED, pendingDecision: DecisionStatus.PENDING, weight: 7 }
];

/**
 * Staff are recruited before hacker apps open: some still in the pipeline, most
 * already confirmed for the event.
 */
const STAFF_STATES: StatePlan[] = [
	{ status: UserStatus.APPLIED, pendingDecision: DecisionStatus.PENDING, weight: 2 },
	{
		status: UserStatus.APPLIED,
		pendingDecision: DecisionStatus.ACCEPTED,
		activeDecision: DecisionStatus.ACCEPTED,
		weight: 3
	},
	{
		status: UserStatus.CONFIRMED,
		pendingDecision: DecisionStatus.ACCEPTED,
		activeDecision: DecisionStatus.ACCEPTED,
		weight: 5
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

	console.log('Scenario 1 — Applications Open\n');
	await seedQuestions(prisma);

	if (process.env.SEED_PRUNE === '1') {
		const pruned = await pruneUnmanagedUsers(prisma, ROLE_PLANS);
		console.log(`\nPruned ${pruned} unmanaged @yopmail.com account(s).`);
	}

	console.log('\nSeeding test accounts...');
	const { users, responses } = await seedUsers(prisma, ROLE_PLANS, { flush: true });
	console.log(summarize(generateUsers(ROLE_PLANS), ROLE_PLANS).join('\n'));
	console.log(`\n  ${users.length} accounts, ${responses} application responses.`);

	console.log('\nDone. Log in at /login with any address above.');
	console.log('  admin1@yopmail.com   — full admin');
	console.log('  hacker1@yopmail.com  — CREATED (registered, not yet applied)');
	console.log('  hacker4@yopmail.com  — APPLIED + PENDING (submitted, in queue)');
}

main()
	.catch((e: unknown) => {
		console.error(e);
		process.exit(1);
	})
	.finally(() => prisma.$disconnect());
