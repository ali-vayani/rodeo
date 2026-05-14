import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Role, UserStatus, DecisionStatus } from '../src/lib/generated/prisma/client';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
	throw new Error('DATABASE_URL is required for seeding');
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const users = [
	{
		name: 'Admin User',
		email: 'admin@yopmail.com',
		roles: [Role.ADMIN],
		status: UserStatus.CREATED
	},
	{
		name: 'Organizer User',
		email: 'organizer@yopmail.com',
		roles: [Role.ORGANIZER],
		status: UserStatus.CREATED
	},
	{
		name: 'Hacker (Filling)',
		email: 'hacker.filling@yopmail.com',
		roles: [Role.HACKER],
		status: UserStatus.CREATED
	},
	{
		name: 'Hacker (Applied)',
		email: 'hacker.applied@yopmail.com',
		roles: [Role.HACKER],
		status: UserStatus.APPLIED,
		pendingDecision: DecisionStatus.PENDING
	},
	{
		name: 'Hacker (Accepted)',
		email: 'hacker.accepted@yopmail.com',
		roles: [Role.HACKER],
		status: UserStatus.APPLIED,
		pendingDecision: DecisionStatus.ACCEPTED,
		activeDecision: DecisionStatus.ACCEPTED
	},
	{
		name: 'Hacker (Confirmed)',
		email: 'hacker.confirmed@yopmail.com',
		roles: [Role.HACKER],
		status: UserStatus.CONFIRMED,
		pendingDecision: DecisionStatus.ACCEPTED,
		activeDecision: DecisionStatus.ACCEPTED
	},
	{
		name: 'Hacker (Waitlisted)',
		email: 'hacker.waitlisted@yopmail.com',
		roles: [Role.HACKER],
		status: UserStatus.APPLIED,
		pendingDecision: DecisionStatus.WAITLISTED,
		activeDecision: DecisionStatus.WAITLISTED
	},
	{
		name: 'Hacker (Rejected)',
		email: 'hacker.rejected@yopmail.com',
		roles: [Role.HACKER],
		status: UserStatus.APPLIED,
		pendingDecision: DecisionStatus.REJECTED,
		activeDecision: DecisionStatus.REJECTED
	},
	{
		name: 'Hacker (Checked In)',
		email: 'hacker.checkedin@yopmail.com',
		roles: [Role.HACKER],
		status: UserStatus.CHECKED_IN,
		pendingDecision: DecisionStatus.ACCEPTED,
		activeDecision: DecisionStatus.ACCEPTED
	},
	{
		name: 'Judge',
		email: 'judge@yopmail.com',
		roles: [Role.JUDGE],
		status: UserStatus.APPLIED,
		pendingDecision: DecisionStatus.PENDING
	},
	{
		name: 'Mentor',
		email: 'mentor@yopmail.com',
		roles: [Role.MENTOR],
		status: UserStatus.APPLIED,
		pendingDecision: DecisionStatus.ACCEPTED,
		activeDecision: DecisionStatus.ACCEPTED
	},
	{
		name: 'Volunteer',
		email: 'volunteer@yopmail.com',
		roles: [Role.VOLUNTEER],
		status: UserStatus.CREATED
	}
];

async function main() {
	console.log('Seeding dev users...');

	for (const u of users) {
		await prisma.user.upsert({
			where: { email: u.email },
			update: u,
			create: u
		});
		console.log(`  ✓ ${u.email}`);
	}

	console.log(`Done. ${users.length} users seeded.`);
}

main()
	.catch((e: unknown) => {
		const code = typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : '';
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
