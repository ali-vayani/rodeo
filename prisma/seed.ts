import 'dotenv/config';
import {
	assertSafeToSeed,
	createPrismaClient,
	seedQuestions,
	seedRubric,
	seedSettings,
	SEED_WINDOWS
} from './seedShared';
import { generateUsers, pruneUnmanagedUsers, seedUsers, summarize } from './seedUsers';
import { DecisionStatus, Role, UserStatus } from '../src/lib/generated/prisma/client';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
	throw new Error('DATABASE_URL is required for seeding');
}

const prisma = createPrismaClient(connectionString);

// Questions run first: the generated application responses are built from whatever
// is in the Question table.
async function main() {
	assertSafeToSeed(connectionString);

	await seedQuestions(prisma);
	await seedSettings(prisma, SEED_WINDOWS.open);
	await seedRubric(prisma);

	if (process.env.SEED_PRUNE === '1') {
		const pruned = await pruneUnmanagedUsers(prisma);
		console.log(`\nPruned ${pruned} unmanaged @yopmail.com account(s).`);
	}

	console.log('\nSeeding test accounts...');
	const { users, responses } = await seedUsers(prisma);
	console.log(summarize(generateUsers()).join('\n'));
	console.log(`\n  ${users.length} accounts, ${responses} application responses.`);

	// Probe branch only (issue #38): 3,000 extra staged decisions so release crosses
	// the transaction-timeout cliff. No application responses — release never reads them.
	const PROBE_DECISIONS = [
		DecisionStatus.ACCEPTED,
		DecisionStatus.REJECTED,
		DecisionStatus.WAITLISTED
	];
	await prisma.user.createMany({
		data: Array.from({ length: 3000 }, (_, i) => ({
			name: `Probe ${i + 1}`,
			email: `probe38-${i + 1}@yopmail.com`,
			role: Role.HACKER,
			status: UserStatus.APPLIED,
			pendingDecision: PROBE_DECISIONS[i % 3]
		})),
		skipDuplicates: true
	});
	const staged = await prisma.user.count({ where: { pendingDecision: { not: null } } });
	console.log(`\n  Probe: 3000 extra pending users seeded; ${staged} total staged decisions.`);

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
