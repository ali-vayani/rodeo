import 'dotenv/config';
import { createPrismaClient } from './seedShared';

const prisma = createPrismaClient(process.env.DATABASE_URL!);

async function check(scenario: string, allowedCheck: (h: { status: string; pendingDecision: string | null; activeDecision: string | null }) => boolean) {
	const hackers = await prisma.user.findMany({
		where: { email: { endsWith: '@yopmail.com', startsWith: 'hacker' } },
		select: { email: true, status: true, pendingDecision: true, activeDecision: true },
		orderBy: { email: 'asc' }
	});

	const counts: Record<string, number> = {};
	const bad: string[] = [];

	for (const h of hackers) {
		const key = `status=${h.status} pending=${h.pendingDecision ?? 'null'} active=${h.activeDecision ?? 'null'}`;
		counts[key] = (counts[key] ?? 0) + 1;
		if (!allowedCheck(h)) bad.push(`${h.email}: ${key}`);
	}

	console.log(`\n=== ${scenario} — hacker state distribution ===`);
	for (const [k, v] of Object.entries(counts)) console.log(`  ${v}x  ${k}`);
	console.log(`Total: ${hackers.length}`);
	if (bad.length) {
		console.log(`\nFAIL — ${bad.length} unexpected:`);
		bad.slice(0, 10).forEach((b) => console.log('  ', b));
	} else {
		console.log('PASS — all hackers in expected states');
	}
}

async function main() {
	const scenario = process.env.CHECK_SCENARIO ?? '1';

	if (scenario === '1') {
		await check('Scenario 1 (open)', (h) =>
			(h.status === 'CREATED' && h.pendingDecision === null && h.activeDecision === null) ||
			(h.status === 'APPLIED' && h.pendingDecision === 'PENDING' && h.activeDecision === null)
		);
	} else if (scenario === '2') {
		await check('Scenario 2 (closed)', (h) =>
			(h.status === 'CREATED' && h.pendingDecision === null && h.activeDecision === null) ||
			(h.status === 'APPLIED' && ['ACCEPTED', 'REJECTED', 'WAITLISTED'].includes(h.pendingDecision ?? '') && h.activeDecision === null)
		);
	} else if (scenario === '3') {
		await check('Scenario 3 (event)', (h) =>
			(h.status === 'CONFIRMED' && h.pendingDecision === 'ACCEPTED' && h.activeDecision === 'ACCEPTED') ||
			(h.status === 'CHECKED_IN' && h.pendingDecision === 'ACCEPTED' && h.activeDecision === 'ACCEPTED') ||
			(h.status === 'APPLIED' && h.pendingDecision === 'ACCEPTED' && h.activeDecision === 'ACCEPTED') ||
			(h.status === 'DECLINED' && h.pendingDecision === 'ACCEPTED' && h.activeDecision === 'ACCEPTED') ||
			(h.status === 'APPLIED' && h.pendingDecision === 'REJECTED' && h.activeDecision === 'REJECTED') ||
			(h.status === 'APPLIED' && h.pendingDecision === 'WAITLISTED' && h.activeDecision === 'WAITLISTED')
		);
	}
}

main()
	.catch(console.error)
	.finally(() => prisma.$disconnect());
