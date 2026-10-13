#!/usr/bin/env node
/**
 * Backfills `User.dietaryRestriction` with `normalizeDietaryRestriction`, dropping the
 * "No dietary restrictions" placeholder from rows written before the live save path
 * excluded it.
 *
 * Defaults to a dry run — it prints what would change and writes nothing. Pass --apply
 * to actually update rows. Idempotent: normalizing an already-clean row is a no-op, so
 * a second run (dry or applied) reports zero changes.
 *
 * Targets whatever DATABASE_URL is set in the environment it's run under, same as every
 * other script here — there is no "local only" guard, since this is meant to run against
 * production too. The host it connected to is always printed first so that's never
 * ambiguous from the output.
 *
 *   npx tsx scripts/backfill-dietary-restriction.ts            # dry run
 *   npx tsx scripts/backfill-dietary-restriction.ts --apply    # writes changes
 */

import 'dotenv/config';
import { createPrismaClient } from '../prisma/seedShared';
import { normalizeDietaryRestriction } from '../src/lib/dietaryRestriction';

const apply = process.argv.includes('--apply');

const url = process.env.DATABASE_URL;
if (!url) {
	throw new Error('DATABASE_URL is not set.');
}

const prisma = createPrismaClient(url);

async function main() {
	const host = (() => {
		try {
			return new URL(url!).hostname;
		} catch {
			return '(unparseable)';
		}
	})();
	console.log(`Target database host: ${host}`);
	console.log(`Mode: ${apply ? 'APPLY (writing changes)' : 'DRY RUN (no writes)'}`);
	console.log('');

	const users = await prisma.user.findMany({
		where: { dietaryRestriction: { isEmpty: false } },
		select: { uid: true, name: true, dietaryRestriction: true }
	});

	let changed = 0;
	let nowEmpty = 0;
	let nowNonEmpty = 0;

	for (const user of users) {
		const before = user.dietaryRestriction;
		const after = normalizeDietaryRestriction(before);
		const isDifferent =
			after.length !== before.length || after.some((value, index) => value !== before[index]);

		if (!isDifferent) continue;

		changed++;
		if (after.length === 0) nowEmpty++;
		else nowNonEmpty++;

		console.log(
			`  ${user.uid} (${user.name}): ${JSON.stringify(before)} -> ${JSON.stringify(after)}`
		);

		if (apply) {
			await prisma.user.update({
				where: { uid: user.uid },
				data: { dietaryRestriction: after }
			});
		}
	}

	console.log('');
	console.log(`Users scanned (non-empty dietaryRestriction): ${users.length}`);
	console.log(`Changed: ${changed}`);
	console.log(`  now [] (moved to regular pool): ${nowEmpty}`);
	console.log(`  now non-empty (kept a real restriction): ${nowNonEmpty}`);
	console.log(`Unchanged: ${users.length - changed}`);

	if (!apply && changed > 0) {
		console.log('');
		console.log('Dry run only — no rows were written. Re-run with --apply to write these changes.');
	}
}

main()
	.catch((error) => {
		console.error('ERROR', error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
