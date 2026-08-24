/**
 * Shared by seed.ts and the three scenario seeds: Prisma client setup, the production
 * guard and the question list, so all four entry points move together when the
 * application form changes.
 */

import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
	PrismaClient,
	Role,
	QuestionType,
	LinkedField,
	OptionPreset
} from '../src/lib/generated/prisma/client';
// The editor applies these when a field is linked; seeding the same values is what
// makes the seeded form an example of the feature rather than a contradiction of it.
import { YEAR_OPTIONS } from '../src/lib/questions/linkedFieldDefaults';
// The same copy `settings.get` falls back to, so a seeded row and an unseeded install
// disagree about nothing but the dates.
import { DEFAULT_SETTINGS } from '../src/lib/server/settings';

/**
 * Pool options for a connection string, mirroring src/lib/server/db.ts: `sslmode=require`
 * is stripped and replaced with ssl that skips cert verification.
 *
 * Inputs:
 * - url: string — Postgres connection string
 *
 * Outputs:
 * - { connectionString: string; ssl?: { rejectUnauthorized: false } }
 */
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

// Duplicated from src/lib/server/env.ts: this runs under tsx with no SvelteKit aliases,
// so it cannot import $lib. Keep the two in step.
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];

function databaseHost(url: string | undefined): string | null {
	if (!url) return null;
	try {
		return new URL(url).hostname || null;
	} catch {
		return null;
	}
}

/**
 * Refuses to seed anything that looks like a real database.
 *
 * Inputs:
 * - url: string | undefined — DATABASE_URL; must point at a local host unless
 *   SEED_ALLOW_REMOTE=1 (with a non-public DATABASE_SCHEMA) or SEED_ALLOW_PRODUCTION=1
 *
 * Throws:
 * - Error — production env vars are set, the host is not local, or SEED_ALLOW_REMOTE
 *   would target the `public` schema
 */
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

// Order 0-9 is reserved for linked/identity questions, which write through to the
// User row on save; general questions start at 10.
export const questions = [
	// --- Identity (linked to User fields) ---
	{
		title: 'Full Name',
		type: QuestionType.SHORT_TEXT,
		required: true,
		targetRole: [] as Role[],
		placeholder: 'Your full name',
		linkedField: LinkedField.NAME,
		order: 0
	},
	{
		title: 'University',
		// Was SHORT_TEXT, which is what put the same school in the filter under four
		// spellings. The preset supplies the list; a missing school is still typed in.
		type: QuestionType.DROPDOWN,
		optionPreset: OptionPreset.UNIVERSITIES_NA,
		required: true,
		targetRole: [Role.HACKER],
		placeholder: 'Search for your school',
		linkedField: LinkedField.UNIVERSITY,
		order: 1
	},
	{
		title: 'Year',
		type: QuestionType.DROPDOWN,
		required: true,
		targetRole: [Role.HACKER],
		placeholder: 'Select your year',
		options: [...YEAR_OPTIONS],
		linkedField: LinkedField.YEAR,
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
	// The only FILE question. seedFiles.ts writes real bytes for its answers, so upload,
	// download and the PDF viewer all have something to exercise.
	{
		title: 'Resume',
		type: QuestionType.FILE,
		required: false,
		targetRole: [Role.HACKER],
		placeholder: 'PDF only',
		order: 26
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

/**
 * Upserts the seed question list. Matched on order+targetRole, not title: titles are
 * editable in the admin UI, so matching on them would duplicate a renamed question.
 *
 * Inputs:
 * - prisma: PrismaClient
 *
 * Side effects:
 * - Creates or updates one Question row per entry in `questions`.
 */
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

// ---------------------------------------------------------------------------
// Settings
//
// Every seed writes this row. Without one the window guards read "no window
// enforced" and fail open, which meant a freshly seeded database could never show a
// closed application or a passed RSVP deadline — including `db:seed:closed`, whose
// whole point is the first of those.
// ---------------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;

/** `n` days from now; negative for the past. */
export function daysOut(n: number): Date {
	return new Date(Date.now() + n * DAY);
}

export type SeedWindow = {
	applicationOpen: Date;
	applicationDeadline: Date;
	RSVPDeadline: Date;
	hackathonStartDate: Date;
};

/**
 * Relative to the run, not fixed calendar dates: a scenario seeded in March must still
 * describe the same moment in the cycle when it is re-run in August.
 */
export const SEED_WINDOWS = {
	/** Applications live, both deadlines ahead. */
	open: {
		applicationOpen: daysOut(-14),
		applicationDeadline: daysOut(21),
		RSVPDeadline: daysOut(35),
		hackathonStartDate: daysOut(42)
	},
	/** Submissions closed, RSVP still ahead — decisions are being worked through. */
	closed: {
		applicationOpen: daysOut(-45),
		applicationDeadline: daysOut(-3),
		RSVPDeadline: daysOut(14),
		hackathonStartDate: daysOut(21)
	},
	/** The morning of: everything shut, the event underway. */
	event: {
		applicationOpen: daysOut(-60),
		applicationDeadline: daysOut(-30),
		RSVPDeadline: daysOut(-7),
		hackathonStartDate: daysOut(0)
	}
} satisfies Record<string, SeedWindow>;

/**
 * Write the Settings row for a scenario. An existing row keeps its email copy: a
 * re-seed moves the clock, it does not discard templates someone was drafting.
 *
 * Inputs:
 * - prisma: PrismaClient — client for the database being seeded
 * - window: SeedWindow — the four dates this scenario presents
 *
 * Outputs:
 * - Promise<void>
 *
 * Side effects:
 * - Creates or updates the single Settings row, and logs the resulting window.
 */
export async function seedSettings(prisma: PrismaClient, window: SeedWindow): Promise<void> {
	const existing = await prisma.settings.findFirst({ select: { id: true } });
	if (existing) {
		await prisma.settings.update({ where: { id: existing.id }, data: window });
	} else {
		await prisma.settings.create({ data: { ...DEFAULT_SETTINGS, ...window } });
	}

	console.log(
		`Settings: applications ${window.applicationOpen.toDateString()} → ` +
			`${window.applicationDeadline.toDateString()}, RSVP by ${window.RSVPDeadline.toDateString()}.`
	);
}
