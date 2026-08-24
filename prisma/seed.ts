import 'dotenv/config';
import {
	assertSafeToSeed,
	createPrismaClient,
	seedQuestions,
	seedSettings,
	SEED_WINDOWS
} from './seedShared';
import { generateUsers, pruneUnmanagedUsers, seedUsers, summarize } from './seedUsers';

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
