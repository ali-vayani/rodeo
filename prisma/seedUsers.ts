import {
	Role,
	UserStatus,
	DecisionStatus,
	QuestionType,
	type PrismaClient,
	type Question,
	type User
} from '../src/lib/generated/prisma/client';
import { isApplicantRole } from '../src/lib/admissions/roles';

// Every account is derived from its index alone, with no randomness, so the same run
// produces the same database twice: hacker42@yopmail.com is always the same person in
// the same state.
//
// Emails are `<role><n>@yopmail.com`, numbered from 1 with no gaps, because the dev
// login accepts any @yopmail.com address that exists in the User table.

const FIRST_NAMES = [
	'Ali',
	'Brandon',
	'Alisha',
	'Adam',
	'Jay',
	'Nikshita',
	'Luis',
	'Vibha',
	'Anshul',
	'Ese',
	'Trang',
	'Raina',
	'Harsh',
	'Sarah',
	'Jai'
];

const LAST_NAMES = [
	'Vayani',
	'Shin',
	'Hmaidan',
	'Patil',
	'Kurva',
	'Pabon',
	'K',
	'Gulati',
	'From-MLH',
	'Tang'
];

/** 15 × 10 = 150 distinct pairings before the generator has to reuse one. */
const COMBOS = FIRST_NAMES.length * LAST_NAMES.length;

/**
 * Spelled as `src/lib/data/universities.json` spells them, which is not how anyone says
 * them out loud. IPEDS files UT Austin under `The University of Texas...`.
 *
 * They have to match, now that the seeded University question draws its choices from
 * that preset. A name the preset does not contain is a write-in, which reproduces the
 * free-text mess this feature exists to end.
 *
 * The last entry is off-list on purpose, so the write-in path has a live example.
 */
const UNIVERSITIES = [
	'The University of Texas at Austin',
	'Texas A & M University-College Station',
	'The University of Texas at Dallas',
	'Rice University',
	'University of Houston',
	'Texas State University',
	'The University of Texas at San Antonio',
	'Baylor University',
	'Georgia Institute of Technology-Main Campus',
	'Riverbend Institute of Technology'
];

const YEARS = ['Freshman', 'Sophomore', 'Junior', 'Senior', 'Graduate', 'Alumni'];

const MAJORS = [
	'Computer Science',
	'Electrical Engineering',
	'Data Science',
	'Mathematics',
	'Mechanical Engineering',
	'Design',
	'Business Analytics',
	'Physics'
];

const DIETS = ['None', 'Vegetarian', 'Vegan', 'Gluten-free', 'Halal', 'No pork', 'Nut allergy'];

const ORGS = [
	'Freetail Hackers',
	'MLH',
	'Google',
	'Capital One',
	'Indeed',
	'Dell',
	'Self-employed',
	'Texas Instruments'
];

const ESSAYS = [
	"I've spent the last year building side projects alone, and I want to find out what happens when I build alongside people who are just as stubborn about shipping. A weekend with a hard deadline is the fastest way to learn that.",
	'My campus club runs small internal hackathons, and every time I walk away with something I could not have learned from a tutorial. I want that at a larger scale, with mentors who have actually shipped the things I am trying to build.',
	'I am switching into software from a non-CS major and I need proof — to myself more than anyone — that I can go from idea to working demo in 24 hours. This event has the mentor density to make that realistic.',
	'Last year I attended as a total beginner and spent most of it lost. I came back knowing exactly what I want to build and who I want to build it with, and I would like to finish what I started.',
	'The sponsor lineup is the real draw. I want feedback on my project from people who work on this class of problem professionally, not just from other students.',
	'Hardware people and software people rarely end up on the same team. I want to be the person who bridges that, and a hackathon is the only place where that experiment is cheap.'
];

const PROJECT_IDEAS = [
	'A mental-health check-in app that tracks mood over time and surfaces campus resources when it detects a downward trend.',
	'An IoT air-quality monitor that alerts a Discord channel when readings on campus spike past safe thresholds.',
	'A pipeline that ingests city council transcripts, extracts action items with an LLM, and drafts public records requests.',
	'A study-group matcher that pairs students by schedule gaps rather than by course, since the hard part is finding overlapping free time.',
	'A browser extension that rewrites dense academic abstracts into plain language without dropping the caveats.',
	'A tool that turns a repo diff into a reviewable narrative, so first-time contributors can see why a change was made.'
];

const MENTOR_TOPICS = [
	'Full-stack web development, mostly React and Node. Happy to help debug anything deployment-related.',
	'Machine learning fundamentals, PyTorch, and talking teams out of training a model when a heuristic would do.',
	'Product and pitch coaching — how to demo something half-finished without lying about it.',
	'Embedded systems, microcontrollers, and the soldering iron. Bring your hardware problems.',
	'Design and UX. I can help you make a weekend project look like it was on purpose.'
];

/** One lifecycle state a generated user can be parked in. */
export type StatePlan = {
	status: UserStatus;
	pendingDecision?: DecisionStatus;
	activeDecision?: DecisionStatus;
	/** How many out of every `weight`-sum users land here. */
	weight: number;
};

/**
 * Hackers are spread across every state the admin UI can render, weighted so the
 * admissions queue (APPLIED + PENDING) stays the biggest bucket.
 */
const HACKER_STATES: StatePlan[] = [
	// Started an application, never submitted.
	{ status: UserStatus.CREATED, weight: 3 },
	// In the queue, untouched.
	{ status: UserStatus.APPLIED, pendingDecision: DecisionStatus.PENDING, weight: 8 },
	// Reviewed but not released — pending set, active still null.
	{ status: UserStatus.APPLIED, pendingDecision: DecisionStatus.ACCEPTED, weight: 2 },
	{ status: UserStatus.APPLIED, pendingDecision: DecisionStatus.WAITLISTED, weight: 1 },
	{ status: UserStatus.APPLIED, pendingDecision: DecisionStatus.REJECTED, weight: 2 },
	// Released decisions, awaiting RSVP.
	{
		status: UserStatus.APPLIED,
		pendingDecision: DecisionStatus.ACCEPTED,
		activeDecision: DecisionStatus.ACCEPTED,
		weight: 3
	},
	{
		status: UserStatus.APPLIED,
		pendingDecision: DecisionStatus.WAITLISTED,
		activeDecision: DecisionStatus.WAITLISTED,
		weight: 2
	},
	{
		status: UserStatus.APPLIED,
		pendingDecision: DecisionStatus.REJECTED,
		activeDecision: DecisionStatus.REJECTED,
		weight: 2
	},
	// RSVP'd.
	{
		status: UserStatus.CONFIRMED,
		pendingDecision: DecisionStatus.ACCEPTED,
		activeDecision: DecisionStatus.ACCEPTED,
		weight: 4
	},
	{
		status: UserStatus.DECLINED,
		pendingDecision: DecisionStatus.ACCEPTED,
		activeDecision: DecisionStatus.ACCEPTED,
		weight: 2
	},
	// Through the door — gives the scan page something to work with.
	{
		status: UserStatus.CHECKED_IN,
		pendingDecision: DecisionStatus.ACCEPTED,
		activeDecision: DecisionStatus.ACCEPTED,
		weight: 3
	}
];

/** Non-hacker roles apply too, but their funnel is much shorter in practice. */
const STAFF_STATES: StatePlan[] = [
	{ status: UserStatus.APPLIED, pendingDecision: DecisionStatus.PENDING, weight: 2 },
	{
		status: UserStatus.APPLIED,
		pendingDecision: DecisionStatus.ACCEPTED,
		activeDecision: DecisionStatus.ACCEPTED,
		weight: 2
	},
	{
		status: UserStatus.CONFIRMED,
		pendingDecision: DecisionStatus.ACCEPTED,
		activeDecision: DecisionStatus.ACCEPTED,
		weight: 3
	},
	{
		status: UserStatus.CHECKED_IN,
		pendingDecision: DecisionStatus.ACCEPTED,
		activeDecision: DecisionStatus.ACCEPTED,
		weight: 1
	}
];

/** Staff who never go through admissions at all. */
const INTERNAL_STATES: StatePlan[] = [{ status: UserStatus.CREATED, weight: 1 }];

export type RolePlan = {
	role: Role;
	/** Email local-part prefix: `hacker` → hacker1@yopmail.com */
	prefix: string;
	/** Env var that overrides the count. */
	envKey: string;
	defaultCount: number;
	states: StatePlan[];
	/** Only hackers carry university/year on the User row. */
	academic: boolean;
};

export const ROLE_PLANS: RolePlan[] = [
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

/**
 * Walks the name pools so consecutive users never share a first name; a table of
 * twelve Alis is a worse fixture than twelve different people.
 */
function nameFor(seq: number): string {
	const first = FIRST_NAMES[seq % FIRST_NAMES.length];
	const last = LAST_NAMES[Math.floor(seq / FIRST_NAMES.length) % LAST_NAMES.length];
	// Past 150 the pairings repeat, so disambiguate rather than emit true duplicates.
	const cycle = Math.floor(seq / COMBOS);
	return cycle === 0 ? `${first} ${last}` : `${first} ${last} ${cycle + 1}`;
}

/** Expand a weighted state list into the flat cycle the index walks. */
function expand(states: StatePlan[]): StatePlan[] {
	return states.flatMap((s) => Array.from({ length: s.weight }, () => s));
}

export type GeneratedUser = {
	name: string;
	email: string;
	role: Role;
	status: UserStatus;
	pendingDecision: DecisionStatus | null;
	activeDecision: DecisionStatus | null;
	university: string | null;
	year: string | null;
};

function countFor(plan: RolePlan): number {
	const raw = process.env[plan.envKey];
	if (raw === undefined) return plan.defaultCount;
	const n = Number.parseInt(raw, 10);
	if (!Number.isFinite(n) || n < 0) {
		throw new Error(`${plan.envKey} must be a non-negative integer, got "${raw}"`);
	}
	return n;
}

/**
 * Builds every account up front. `seq` runs across roles rather than restarting per
 * role, so admin1 and hacker1 are different people.
 *
 * Inputs:
 * - rolePlans: RolePlan[] — state distributions per role; scenario seeds pass their own
 *
 * Outputs:
 * - GeneratedUser[] — deterministic for a given plan list and SEED_* env counts
 *
 * Throws:
 * - Error — a SEED_* count env var is not a non-negative integer
 */
export function generateUsers(rolePlans: RolePlan[] = ROLE_PLANS): GeneratedUser[] {
	const out: GeneratedUser[] = [];
	let seq = 0;

	for (const plan of rolePlans) {
		const cycle = expand(plan.states);
		const count = countFor(plan);

		for (let i = 0; i < count; i++) {
			const state = cycle[i % cycle.length];
			out.push({
				name: nameFor(seq),
				email: `${plan.prefix}${i + 1}@yopmail.com`,
				role: plan.role,
				status: state.status,
				pendingDecision: state.pendingDecision ?? null,
				activeDecision: state.activeDecision ?? null,
				university: plan.academic ? UNIVERSITIES[seq % UNIVERSITIES.length] : null,
				year: plan.academic ? YEARS[seq % YEARS.length] : null
			});
			seq++;
		}
	}

	return out;
}

function shortAnswer(title: string, user: GeneratedUser, seq: number): string {
	const t = title.toLowerCase();
	if (t.includes('phone')) {
		return `(512) 555-${String(1000 + (seq % 9000)).slice(0, 4)}`;
	}
	if (t.includes('url') || t.includes('github') || t.includes('portfolio')) {
		return `https://github.com/${user.name.toLowerCase().replace(/[^a-z]/g, '')}`;
	}
	if (t.includes('dietary')) return DIETS[seq % DIETS.length];
	if (t.includes('major') || t.includes('field of study')) return MAJORS[seq % MAJORS.length];
	if (t.includes('organization') || t.includes('company')) return ORGS[seq % ORGS.length];
	return `${title} — response ${seq + 1}`;
}

function longAnswer(title: string, seq: number): string {
	const t = title.toLowerCase();
	if (t.includes('build') || t.includes('learn')) return PROJECT_IDEAS[seq % PROJECT_IDEAS.length];
	if (t.includes('mentor')) return MENTOR_TOPICS[seq % MENTOR_TOPICS.length];
	if (t.includes('volunteer') || t.includes('experience')) {
		return `I helped run ${ORGS[seq % ORGS.length]}'s student events for two semesters — mostly check-in, food logistics, and keeping the schedule honest.`;
	}
	return ESSAYS[seq % ESSAYS.length];
}

function answerFor(q: Question, user: GeneratedUser, seq: number): string | null {
	// Linked questions write through to the User row, so they must agree with it.
	if (q.linkedField === 'NAME') return user.name;
	if (q.linkedField === 'UNIVERSITY')
		return user.university ?? UNIVERSITIES[seq % UNIVERSITIES.length];
	if (q.linkedField === 'YEAR') return user.year ?? YEARS[seq % YEARS.length];

	switch (q.type) {
		case QuestionType.DROPDOWN:
		case QuestionType.MULTIPLE_CHOICE:
			return q.options.length ? q.options[seq % q.options.length] : null;
		case QuestionType.CHECKBOX:
			return seq % 3 === 0 ? 'true' : 'false';
		case QuestionType.NUMBER: {
			const min = q.min ?? 0;
			const max = q.max ?? min + 10;
			const span = Math.max(1, Math.floor(max - min) + 1);
			return String(min + (seq % span));
		}
		case QuestionType.LONG_TEXT:
			return longAnswer(q.title, seq);
		case QuestionType.SHORT_TEXT:
		default:
			return shortAnswer(q.title, user, seq);
	}
}

/** A question with no targetRole applies to everyone. */
function appliesTo(q: Question, user: GeneratedUser): boolean {
	return q.targetRole.length === 0 || q.targetRole.includes(user.role);
}

export type GeneratedResponse = { userId: string; questionId: string; value: string };

/**
 * Builds application responses from whatever questions are in the database, so adding
 * a question in /admin/registration and re-seeding fills it in for everyone.
 *
 * Inputs:
 * - users: (GeneratedUser & { uid: string })[] — saved accounts; staff roles are skipped
 * - questions: Question[] — any order; sorted by `order` here
 *
 * Outputs:
 * - GeneratedResponse[] — rows ready for `applicationResponse.createMany`
 */
export function generateResponses(
	users: (GeneratedUser & { uid: string })[],
	questions: Question[]
): GeneratedResponse[] {
	const ordered = [...questions].sort((a, b) => a.order - b.order);
	const out: GeneratedResponse[] = [];

	users.forEach((user, seq) => {
		// Staff are provisioned directly and never apply. Generating responses for them
		// would put an unreviewable row in the admissions queue.
		if (!isApplicantRole(user.role)) return;

		const mine = ordered.filter((q) => appliesTo(q, user));

		// CREATED users never submitted, so they get a half-filled form — that is the
		// state the hacker application page has to resume from.
		const limit = user.status === UserStatus.CREATED ? Math.ceil(mine.length / 2) : mine.length;

		mine.slice(0, limit).forEach((q, qi) => {
			// Leave some optional questions blank so "no answer" rendering gets exercised.
			if (!q.required && (seq + qi) % 4 === 0) return;
			const value = answerFor(q, user, seq + qi);
			if (value === null) return;
			out.push({ userId: user.uid, questionId: q.id, value });
		});
	});

	return out;
}

/**
 * Seeds every generated account and rebuilds its application responses.
 *
 * Inputs:
 * - prisma: PrismaClient
 * - rolePlans: RolePlan[] | undefined — defaults to ROLE_PLANS
 * - flush: boolean — delete the generated accounts first (scenario seeds do this),
 *   which also clears review scores, claim locks and decision attribution
 *
 * Outputs:
 * - { users: User[]; responses: number } — saved rows and the response count
 *
 * Side effects:
 * - Without flush, upserts by email, so re-running resets an account to its generated
 *   state without creating a second copy. Always replaces the accounts' responses.
 */
export async function seedUsers(
	prisma: PrismaClient,
	rolePlans?: RolePlan[],
	{ flush = false }: { flush?: boolean } = {}
): Promise<{ users: User[]; responses: number }> {
	const generated = generateUsers(rolePlans);

	if (flush) {
		const emails = generated.map((u) => u.email);
		await prisma.user.deleteMany({ where: { email: { in: emails } } });
	}

	const saved: (GeneratedUser & { uid: string })[] = [];
	const rows: User[] = [];

	for (const u of generated) {
		if (flush) {
			const row = await prisma.user.create({ data: u });
			rows.push(row);
			saved.push({ ...u, uid: row.uid });
		} else {
			const row = await prisma.user.upsert({
				where: { email: u.email },
				update: u,
				create: u
			});
			rows.push(row);
			saved.push({ ...u, uid: row.uid });
		}
	}

	const questions = await prisma.question.findMany();
	const responses = generateResponses(saved, questions);

	const uids = saved.map((u) => u.uid);
	await prisma.applicationResponse.deleteMany({ where: { userId: { in: uids } } });
	if (responses.length) {
		await prisma.applicationResponse.createMany({ data: responses });
	}

	return { users: rows, responses: responses.length };
}

/**
 * Deletes every @yopmail.com account this generator did not produce. Destructive;
 * callers gate it behind SEED_PRUNE=1 (`npm run db:seed:fresh`).
 *
 * Inputs:
 * - prisma: PrismaClient
 * - rolePlans: RolePlan[] | undefined — defines the set to keep; defaults to ROLE_PLANS
 *
 * Outputs:
 * - number — accounts deleted
 */
export async function pruneUnmanagedUsers(
	prisma: PrismaClient,
	rolePlans?: RolePlan[]
): Promise<number> {
	const keep = generateUsers(rolePlans).map((u) => u.email);
	const { count } = await prisma.user.deleteMany({
		where: { email: { endsWith: '@yopmail.com', notIn: keep } }
	});
	return count;
}

export function summarize(users: GeneratedUser[], rolePlans: RolePlan[] = ROLE_PLANS): string[] {
	return rolePlans.map((plan) => {
		const mine = users.filter((u) => u.role === plan.role);
		if (!mine.length) return `  ${plan.role.toLowerCase()}: none`;
		const first = mine[0].email;
		const last = mine[mine.length - 1].email;
		return `  ${plan.role.toLowerCase().padEnd(10)} ${String(mine.length).padStart(4)}  ${first} … ${last}`;
	});
}
