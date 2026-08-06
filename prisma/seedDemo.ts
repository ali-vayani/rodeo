import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import {
	PrismaClient,
	Role,
	UserStatus,
	DecisionStatus,
	ScheduleType
} from '../src/lib/generated/prisma/client';
import { generateResponses, type GeneratedUser } from './seedUsers';

// ---------------------------------------------------------------------------
// Demo import: a previous production database, anonymized
//
// Reads the CSV export of the old Rodeo's production tables (users, teams,
// scans, schedule) and writes an equivalent *anonymized* population into this
// schema: same admissions funnel, same team shapes, same check-in traffic and
// event schedule — none of the real people.
//
//   DEMO_DATA_DIR=~/Desktop/hhg-rodeo-data npm run db:seed:demo
//
// Run `npm run db:seed` first: application responses are generated from
// whatever questions the ordinary seed created. Identities are replaced
// wholesale (demo<n>@yopmail.com, names from a fixed pool) and free-text
// answers are generated, not copied — the export's real names, emails, and
// essay answers never leave the source directory.
// ---------------------------------------------------------------------------

const DATA_DIR = process.env.DEMO_DATA_DIR;
if (!DATA_DIR) {
	throw new Error(
		'DEMO_DATA_DIR is required — point it at the old-production CSV export directory.'
	);
}
const dataDir = DATA_DIR.replace(/^~(?=\/)/, process.env.HOME ?? '~');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
	throw new Error('DATABASE_URL is required for seeding');
}

// Same libpq-compatible sslmode=require handling as src/lib/server/db.ts.
function poolTls(url: string) {
	if (!url.includes('sslmode=require')) return { connectionString: url };
	const stripped = new URL(url);
	stripped.searchParams.delete('sslmode');
	return { connectionString: stripped.toString(), ssl: { rejectUnauthorized: false } };
}

const adapter = new PrismaPg(poolTls(connectionString));
const prisma = new PrismaClient({ adapter });

// ---------------------------------------------------------------------------
// Production guard — same rules as prisma/seed.ts, duplicated for the same
// reason that file duplicates src/lib/server/env.ts: tsx has no $lib aliases,
// and seed.ts is an entrypoint that runs main() on import. Keep the three in step.
// ---------------------------------------------------------------------------

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];

function assertSafeToSeed(url: string): void {
	if (process.env.SEED_ALLOW_PRODUCTION === '1') return;

	const refuse = (reason: string): never => {
		throw new Error(
			`Refusing to import demo data: ${reason}\n\n` +
				'  • Point DATABASE_URL at your local Postgres (see .env.example), or\n' +
				'  • target a preview/staging database with SEED_ALLOW_REMOTE=1, or\n' +
				'  • run with SEED_ALLOW_PRODUCTION=1 if you genuinely mean to.'
		);
	};

	if (process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production') {
		refuse('this is a production environment (VERCEL_ENV / NODE_ENV).');
	}

	const parsed = (() => {
		try {
			return new URL(url);
		} catch {
			return null;
		}
	})();

	if (process.env.SEED_ALLOW_REMOTE === '1') {
		const dbName = parsed?.pathname.replace(/^\//, '') || null;
		if (!dbName || dbName === 'postgres') {
			refuse('SEED_ALLOW_REMOTE=1 is set but DATABASE_URL looks like production, not a preview.');
		}
		return;
	}

	const host = parsed?.hostname || null;
	if (!host || !LOCAL_HOSTS.includes(host)) {
		refuse(`DATABASE_URL points at ${host ?? 'an unparseable host'}, not a local database.`);
	}
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** Minimal RFC-4180 parser: quoted fields, embedded commas/quotes/newlines. */
function parseCsv(text: string): Record<string, string>[] {
	const rows: string[][] = [];
	let field = '';
	let row: string[] = [];
	let inQuotes = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (inQuotes) {
			if (c === '"' && text[i + 1] === '"') {
				field += '"';
				i++;
			} else if (c === '"') {
				inQuotes = false;
			} else {
				field += c;
			}
		} else if (c === '"') {
			inQuotes = true;
		} else if (c === ',') {
			row.push(field);
			field = '';
		} else if (c === '\n' || c === '\r') {
			if (c === '\r' && text[i + 1] === '\n') i++;
			row.push(field);
			field = '';
			if (row.length > 1 || row[0] !== '') rows.push(row);
			row = [];
		} else {
			field += c;
		}
	}
	if (field !== '' || row.length) {
		row.push(field);
		rows.push(row);
	}
	const [header, ...body] = rows;
	return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

function readCsv(name: string): Record<string, string>[] {
	return parseCsv(fs.readFileSync(path.join(dataDir, name), 'utf8'));
}

// ---------------------------------------------------------------------------
// Anonymized identities — a pool distinct from seedUsers' so demo accounts are
// recognizable at a glance, derived from the row index alone (deterministic).
// ---------------------------------------------------------------------------

const FIRST = [
	'Avery',
	'Bela',
	'Cass',
	'Dev',
	'Emory',
	'Finley',
	'Gale',
	'Hollis',
	'Indra',
	'Jules',
	'Kit',
	'Lane',
	'Marlow',
	'Noor',
	'Onyx',
	'Perry',
	'Quill',
	'Reese',
	'Sage',
	'Tatum',
	'Uma',
	'Vesper',
	'Wren',
	'Xen',
	'Yael',
	'Zephyr'
] as const;
const LAST = [
	'Acosta',
	'Blakely',
	'Calloway',
	'Dupree',
	'Ellington',
	'Fairbanks',
	'Grantham',
	'Holloway',
	'Ibarra',
	'Jennings',
	'Kessler',
	'Lockhart',
	'Merriweather',
	'Northcutt',
	'Oakes',
	'Prescott',
	'Quimby',
	'Rutherford',
	'Sinclair',
	'Thackeray',
	'Underwood',
	'Vanterpool',
	'Winslow',
	'Yarborough',
	'Zimmerman'
] as const;

function demoName(i: number): string {
	const combos = FIRST.length * LAST.length;
	const base = `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]}`;
	const cycle = Math.floor(i / combos);
	return cycle === 0 ? base : `${base} ${cycle + 1}`;
}

const UNIVERSITIES = [
	'University of Texas at Austin',
	'Texas A&M University',
	'University of Houston',
	'Texas State University',
	'Rice University',
	'UT Dallas',
	'UT San Antonio'
] as const;
const YEARS = ['Freshman', 'Sophomore', 'Junior', 'Senior', 'Graduate'] as const;

// ---------------------------------------------------------------------------
// Old → new mappings
// ---------------------------------------------------------------------------

/** Old AuthUser.status carried the decision; here status and decision are separate. */
function mapStatus(old: string): {
	status: UserStatus;
	activeDecision: DecisionStatus | null;
	pendingDecision: DecisionStatus | null;
} {
	switch (old) {
		case 'APPLIED':
			return { status: UserStatus.APPLIED, activeDecision: null, pendingDecision: null };
		case 'ACCEPTED':
			return {
				status: UserStatus.APPLIED,
				activeDecision: DecisionStatus.ACCEPTED,
				pendingDecision: null
			};
		case 'REJECTED':
			return {
				status: UserStatus.APPLIED,
				activeDecision: DecisionStatus.REJECTED,
				pendingDecision: null
			};
		case 'WAITLISTED':
			return {
				status: UserStatus.APPLIED,
				activeDecision: DecisionStatus.WAITLISTED,
				pendingDecision: null
			};
		case 'CONFIRMED':
			return {
				status: UserStatus.CONFIRMED,
				activeDecision: DecisionStatus.ACCEPTED,
				pendingDecision: null
			};
		case 'DECLINED':
			return {
				status: UserStatus.DECLINED,
				activeDecision: DecisionStatus.ACCEPTED,
				pendingDecision: null
			};
		default:
			return { status: UserStatus.CREATED, activeDecision: null, pendingDecision: null };
	}
}

/** UNDECLARED-only accounts read as hackers here — that is what a first login creates. */
function mapRoles(oldJson: string): Role[] {
	let parsed: string[];
	try {
		parsed = JSON.parse(oldJson) as string[];
	} catch {
		parsed = [];
	}
	const known = new Set(Object.values(Role) as string[]);
	const roles = parsed.filter((r) => r !== 'UNDECLARED' && known.has(r)) as Role[];
	return roles.length ? roles : [Role.HACKER];
}

function mapScheduleType(oldType: string, name: string): ScheduleType {
	if (/ceremony/i.test(name)) return ScheduleType.CEREMONY;
	switch (oldType) {
		case 'workshops':
			return ScheduleType.WORKSHOP;
		case 'meals':
			return ScheduleType.MEAL;
		default:
			return ScheduleType.EVENT;
	}
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	assertSafeToSeed(connectionString!);

	const authUsers = readCsv('AuthUser_rows.csv');
	const oldUsers = readCsv('User_rows.csv');
	const oldTeams = readCsv('Team_rows.csv');
	const oldScans = readCsv('Scan_rows.csv');
	const oldEvents = readCsv('Event_rows.csv');

	const questions = await prisma.question.findMany();
	if (!questions.length) {
		throw new Error('No questions in this database — run `npm run db:seed` first.');
	}

	// --- Schedule ---
	console.log('Importing schedule...');
	for (const e of oldEvents) {
		const data = {
			name: e.name,
			description: e.description || null,
			start: new Date(e.start),
			end: new Date(e.end),
			location: e.location || 'TBD',
			type: mapScheduleType(e.type, e.name)
		};
		const existing = await prisma.schedule.findFirst({
			where: { name: data.name, start: data.start }
		});
		if (existing) {
			await prisma.schedule.update({ where: { id: existing.id }, data });
		} else {
			await prisma.schedule.create({ data });
		}
	}
	console.log(`  ${oldEvents.length} schedule entries`);

	// --- Teams ---
	console.log('Importing teams...');
	const teamIdMap = new Map<string, string>();
	for (const t of oldTeams) {
		const existing = await prisma.team.findFirst({ where: { teamName: t.name } });
		const row = existing ?? (await prisma.team.create({ data: { teamName: t.name } }));
		teamIdMap.set(t.id, row.id);
	}
	console.log(`  ${teamIdMap.size} teams`);

	// --- Users ---
	console.log('Importing users (anonymized)...');
	const byAuthId = new Map(oldUsers.map((u) => [u.authUserId, u]));
	const scansByOldUser = new Map<string, { action: string; timestamp: string }[]>();
	for (const s of oldScans) {
		const list = scansByOldUser.get(s.userId) ?? [];
		list.push({ action: s.action, timestamp: s.timestamp });
		scansByOldUser.set(s.userId, list);
	}

	const saved: (GeneratedUser & { uid: string })[] = [];
	let scanRows = 0;
	for (let i = 0; i < authUsers.length; i++) {
		const a = authUsers[i];
		const profile = byAuthId.get(a.id);
		const scans = scansByOldUser.get(a.id) ?? [];
		const mapped = mapStatus(a.status);
		// The old schema had no CHECKED_IN status — being scanned was the signal.
		const status =
			scans.length && mapped.status === UserStatus.CONFIRMED
				? UserStatus.CHECKED_IN
				: mapped.status;
		const roles = mapRoles(a.roles);
		const academic = roles.some((r) => r === Role.HACKER || r === Role.VOLUNTEER);

		const u: GeneratedUser = {
			name: demoName(i),
			email: `demo${i + 1}@yopmail.com`,
			roles,
			status,
			pendingDecision: mapped.pendingDecision,
			activeDecision: mapped.activeDecision,
			university: academic ? UNIVERSITIES[i % UNIVERSITIES.length] : null,
			year: academic ? YEARS[i % YEARS.length] : null
		};

		const row = await prisma.user.upsert({
			where: { email: u.email },
			update: { ...u, teamId: profile?.teamId ? (teamIdMap.get(profile.teamId) ?? null) : null },
			create: { ...u, teamId: profile?.teamId ? (teamIdMap.get(profile.teamId) ?? null) : null }
		});
		saved.push({ ...u, uid: row.uid });

		await prisma.scan.deleteMany({ where: { userId: row.uid } });
		if (scans.length) {
			await prisma.scan.createMany({
				data: scans.map((s) => ({
					userId: row.uid,
					action: s.action,
					timestamp: new Date(s.timestamp)
				}))
			});
			scanRows += scans.length;
		}
	}
	console.log(`  ${saved.length} accounts, ${scanRows} scans`);

	// --- Application responses, from this schema's own questions ---
	console.log('Generating application responses...');
	const responses = generateResponses(saved, questions);
	await prisma.applicationResponse.deleteMany({
		where: { userId: { in: saved.map((u) => u.uid) } }
	});
	if (responses.length) {
		await prisma.applicationResponse.createMany({ data: responses });
	}
	console.log(`  ${responses.length} responses`);

	console.log(
		'\nDone. Demo accounts are demo1@yopmail.com … ' + `demo${saved.length}@yopmail.com.`
	);
}

main()
	.catch((e: unknown) => {
		console.error(e);
		process.exit(1);
	})
	.finally(() => prisma.$disconnect());
