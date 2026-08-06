import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Role, QuestionType } from '../src/lib/generated/prisma/client';
import { generateUsers, pruneUnmanagedUsers, seedUsers, summarize } from './seedUsers';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
	throw new Error('DATABASE_URL is required for seeding');
}

// Same libpq-compatible sslmode=require handling as src/lib/server/db.ts:
// strip the parameter (node-pg reads it as verify-full and lets the URL win
// over an explicit ssl option) and encrypt without verifying, so the CI seed
// can reach Supabase's poolers.
function poolTls(url: string) {
	if (!url.includes('sslmode=require')) return { connectionString: url };
	const stripped = new URL(url);
	stripped.searchParams.delete('sslmode');
	return { connectionString: stripped.toString(), ssl: { rejectUnauthorized: false } };
}

const adapter = new PrismaPg(poolTls(connectionString));
const prisma = new PrismaClient({ adapter });

// ---------------------------------------------------------------------------
// Production guard
//
// This script writes passwordless @yopmail.com admin accounts, and with
// SEED_PRUNE=1 it deletes every @yopmail.com account it did not generate. The
// only thing deciding which database that lands in is whichever DATABASE_URL
// happens to be in .env — one stale line and `npm run db:seed` is a privilege
// escalation into production rather than a dev convenience.
//
// Deliberately duplicated from src/lib/server/env.ts: this runs under tsx with
// no SvelteKit aliases, so it cannot import $lib. Keep the two in step.
// ---------------------------------------------------------------------------

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];

/** The host DATABASE_URL points at, or null when it can't be read as one. */
function databaseHost(url: string | undefined): string | null {
	if (!url) return null;
	try {
		return new URL(url).hostname || null;
	} catch {
		return null;
	}
}

function assertSafeToSeed(url: string | undefined): void {
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

	// CI seeds per-branch preview databases on the shared Supabase server.
	// SEED_ALLOW_REMOTE lifts only the localhost requirement — the production
	// refusal above still applies — and it still refuses the database literally
	// named "postgres": that is the production database on Supabase, and no
	// preview branch is ever named that (CI names databases after
	// CI_COMMIT_REF_SLUG, and the default branch is "mainline").
	if (process.env.SEED_ALLOW_REMOTE === '1') {
		const dbName = (() => {
			try {
				return new URL(url ?? '').pathname.replace(/^\//, '') || null;
			} catch {
				return null;
			}
		})();
		if (!dbName || dbName === 'postgres') {
			refuse(
				`SEED_ALLOW_REMOTE=1 is set but DATABASE_URL points at ${
					dbName ? `the "${dbName}" database` : 'a database this script could not parse'
				} — that looks like production, not a preview branch.`
			);
		}
		return;
	}

	// Unreadable counts as remote: a URL this script can't parse is not one it can
	// vouch for.
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

const questions = [
	// --- Identity (linked to User fields) ---
	{
		title: 'Full Name',
		type: QuestionType.SHORT_TEXT,
		required: true,
		targetRole: [] as Role[], // all roles
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
// Main
//
// Questions run first: the generated application responses are built from
// whatever is in the Question table, so they need it populated.
// ---------------------------------------------------------------------------

async function main() {
	assertSafeToSeed(connectionString);

	console.log('Seeding questions...');
	for (const q of questions) {
		// Matched on order, not title. Titles are editable in
		// /admin/application-editor, and matching on one meant that renaming a
		// seeded question and re-seeding produced a second copy of it rather than
		// updating the original. `order` is this file's own numbering scheme (see
		// the block comment above the list) and is the closest thing to a stable
		// key the schema offers; targetRole disambiguates the two questions that
		// share a title across roles.
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

	if (process.env.SEED_PRUNE === '1') {
		const pruned = await pruneUnmanagedUsers(prisma);
		console.log(`\nPruned ${pruned} unmanaged @yopmail.com account(s).`);
	}

	console.log('\nSeeding test accounts...');
	const { users, responses } = await seedUsers(prisma);
	console.log(summarize(generateUsers()).join('\n'));
	console.log(`\n  ${users.length} accounts, ${responses} application responses.`);

	console.log('\nDone. Log in at /login with any address above.');
}

main()
	.catch((e: unknown) => {
		const code =
			typeof e === 'object' && e !== null && 'code' in e
				? String((e as { code: unknown }).code)
				: '';
		if (code === 'P2021') {
			console.error(
				'No tables in this database yet. Create them first, then seed again:\n' +
					'  npm run db:push     — sync schema (good for local dev)\n' +
					'  npm run db:migrate  — apply migrations\n' +
					'Or one step: npm run db:setup (push + seed).'
			);
		}
		console.error(e);
		process.exit(1);
	})
	.finally(() => prisma.$disconnect());
