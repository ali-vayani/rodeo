/**
 * Infrastructure shared by seed.ts and the three scenario seed scripts.
 *
 * Keeping the Prisma client setup, production guard, question list, and question
 * seeding here means all four entry points stay in sync when the application form
 * changes — edit the questions once and every seed picks them up.
 */

import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Role, QuestionType } from '../src/lib/generated/prisma/client';

// ---------------------------------------------------------------------------
// Prisma client
// ---------------------------------------------------------------------------

/** Strip sslmode=require and re-add ssl without cert verification, same as db.ts. */
export function poolTls(url: string) {
	if (!url.includes('sslmode=require')) return { connectionString: url };
	const stripped = new URL(url);
	stripped.searchParams.delete('sslmode');
	return { connectionString: stripped.toString(), ssl: { rejectUnauthorized: false } };
}

export function createPrismaClient(connectionString: string): PrismaClient {
	const adapter = new PrismaPg(
		poolTls(connectionString),
		process.env.DATABASE_SCHEMA ? { schema: process.env.DATABASE_SCHEMA } : undefined
	);
	return new PrismaClient({ adapter });
}

// ---------------------------------------------------------------------------
// Production guard
//
// Deliberately duplicated from src/lib/server/env.ts: this runs under tsx with
// no SvelteKit aliases, so it cannot import $lib. Keep the two in step.
// ---------------------------------------------------------------------------

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];

function databaseHost(url: string | undefined): string | null {
	if (!url) return null;
	try {
		return new URL(url).hostname || null;
	} catch {
		return null;
	}
}

export function assertSafeToSeed(url: string | undefined): void {
	if (process.env.SEED_ALLOW_PRODUCTION === '1') return;

	const refuse = (reason: string): never => {
		throw new Error(
			`Refusing to seed: ${reason}\n\n` +
				'This script creates passwordless @yopmail.com admin accounts, and\n' +
				'`npm run db:seed:fresh` deletes every @yopmail.com account it did not\n' +
				'generate. Neither is survivable against a real database.\n\n' +
				'  • Point DATABASE_URL at your local Postgres (see .env.example), or\n' +
				'  • in CI, seed a per-branch preview database with SEED_ALLOW_REMOTE=1, or\n' +
				'  • run with SEED_ALLOW_PRODUCTION=1 if you genuinely mean to seed this one.'
		);
	};

	if (process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production') {
		refuse('this is a production environment (VERCEL_ENV / NODE_ENV).');
	}

	if (process.env.SEED_ALLOW_REMOTE === '1') {
		const schema = process.env.DATABASE_SCHEMA;
		if (!schema || schema === 'public') {
			refuse(
				'SEED_ALLOW_REMOTE=1 is set but DATABASE_SCHEMA ' +
					(schema ? 'is "public"' : 'is not set') +
					' — that would seed production, not a preview branch schema.'
			);
		}
		return;
	}

	const host = databaseHost(url);
	if (!host || !LOCAL_HOSTS.includes(host)) {
		refuse(
			`DATABASE_URL points at ${host ?? 'a host this script could not parse'}, not a local database.`
		);
	}
}

// ---------------------------------------------------------------------------
// Questions
// Linked questions write through to the User model on save.
// Order 0–9 reserved for linked/identity questions; general questions start at 10.
// ---------------------------------------------------------------------------

const YEAR_OPTIONS = ['Freshman', 'Sophomore', 'Junior', 'Senior', 'Graduate', 'Alumni'];

export const questions = [
	// --- Identity (linked to User fields) ---
	{
		title: 'Full Name',
		type: QuestionType.SHORT_TEXT,
		required: true,
		targetRole: [] as Role[],
		placeholder: 'Your full name',
		linkedField: 'name',
		order: 0
	},
	{
		title: 'University',
		type: QuestionType.SHORT_TEXT,
		required: true,
		targetRole: [Role.HACKER],
		placeholder: 'e.g. University of Texas at Austin',
		linkedField: 'university',
		order: 1
	},
	{
		title: 'Year',
		type: QuestionType.DROPDOWN,
		required: true,
		targetRole: [Role.HACKER],
		placeholder: 'Select your year',
		options: YEAR_OPTIONS,
		linkedField: 'year',
		order: 2
	},

	// --- General (all roles) ---
	{
		title: 'Phone Number',
		type: QuestionType.SHORT_TEXT,
		required: false,
		targetRole: [] as Role[],
		placeholder: 'e.g. (512) 555-0100',
		order: 10
	},
	{
		title: 'T-Shirt Size',
		type: QuestionType.DROPDOWN,
		required: true,
		targetRole: [] as Role[],
		placeholder: 'Select a size',
		options: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
		order: 11
	},
	{
		title: 'Dietary Restrictions',
		type: QuestionType.SHORT_TEXT,
		required: false,
		targetRole: [] as Role[],
		placeholder: 'e.g. vegetarian, gluten-free, none',
		order: 12
	},

	// --- Hacker-specific ---
	{
		title: 'Major / Field of Study',
		type: QuestionType.SHORT_TEXT,
		required: false,
		targetRole: [Role.HACKER],
		placeholder: 'e.g. Computer Science',
		order: 20
	},
	{
		title: 'How many hackathons have you attended?',
		type: QuestionType.DROPDOWN,
		required: true,
		targetRole: [Role.HACKER],
		placeholder: 'Select one',
		options: ['This is my first!', '1–2', '3–5', '6–10', '10+'],
		order: 21
	},
	{
		title: 'GitHub / Portfolio URL',
		type: QuestionType.SHORT_TEXT,
		required: false,
		targetRole: [Role.HACKER],
		placeholder: 'https://',
		order: 22
	},
	{
		title: 'Why do you want to attend?',
		type: QuestionType.LONG_TEXT,
		required: true,
		targetRole: [Role.HACKER],
		placeholder: 'Tell us what excites you about this hackathon (max 300 words)',
		order: 23
	},
	{
		title: 'What do you hope to build or learn?',
		type: QuestionType.LONG_TEXT,
		required: false,
		targetRole: [Role.HACKER],
		placeholder: 'Any project ideas or skills you want to develop?',
		order: 24
	},
	{
		title: 'Do you need travel reimbursement?',
		type: QuestionType.CHECKBOX,
		required: false,
		targetRole: [Role.HACKER],
		placeholder: 'Yes, I need travel assistance',
		order: 25
	},

	// --- Judge-specific ---
	{
		title: 'Organization / Company',
		type: QuestionType.SHORT_TEXT,
		required: true,
		targetRole: [Role.JUDGE],
		placeholder: 'Your current employer or organization',
		order: 30
	},
	{
		title: 'Area of Expertise',
		type: QuestionType.MULTIPLE_CHOICE,
		required: true,
		targetRole: [Role.JUDGE],
		options: ['Software Engineering', 'Design / UX', 'Product', 'Data / ML', 'Hardware', 'Other'],
		order: 31
	},

	// --- Mentor-specific ---
	{
		title: 'Organization / Company',
		type: QuestionType.SHORT_TEXT,
		required: true,
		targetRole: [Role.MENTOR],
		placeholder: 'Your current employer or organization',
		order: 40
	},
	{
		title: 'Topics you can mentor on',
		type: QuestionType.LONG_TEXT,
		required: true,
		targetRole: [Role.MENTOR],
		placeholder: 'e.g. web development, machine learning, product design',
		order: 41
	},

	// --- Volunteer-specific ---
	{
		title: 'Which shifts are you available for?',
		type: QuestionType.MULTIPLE_CHOICE,
		required: true,
		targetRole: [Role.VOLUNTEER],
		options: [
			'Friday evening setup',
			'Saturday morning',
			'Saturday afternoon',
			'Sunday morning',
			'Sunday breakdown'
		],
		order: 50
	},
	{
		title: 'Any prior volunteer experience?',
		type: QuestionType.LONG_TEXT,
		required: false,
		targetRole: [Role.VOLUNTEER],
		placeholder: "Tell us about events you've helped run before",
		order: 51
	}
];

// ---------------------------------------------------------------------------
// Question seeding
// Matched on order+targetRole, not title. Titles are editable in the admin UI;
// matching on them would produce a second copy of a question when its title is
// renamed and then re-seeded.
// ---------------------------------------------------------------------------

export async function seedQuestions(prisma: PrismaClient): Promise<void> {
	console.log('Seeding questions...');
	for (const q of questions) {
		const existing = await prisma.question.findFirst({
			where: { order: q.order, targetRole: { equals: q.targetRole } }
		});
		if (existing) {
			await prisma.question.update({ where: { id: existing.id }, data: q });
			console.log(`  ~ ${q.title} (updated)`);
		} else {
			await prisma.question.create({ data: q });
			console.log(`  ✓ ${q.title}`);
		}
	}
}
