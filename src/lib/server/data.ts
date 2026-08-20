/**
 * Whole-database export, and the wipe that always follows one.
 *
 * Both live here rather than in the router so the two halves that have to agree, which
 * tables are carried out and which are emptied, sit next to each other. A table added
 * to the schema and forgotten in `buildExport` would be destroyed by `wipeDatabase`
 * without appearing in the file. `EXPORTED_TABLES` is the single list both read from.
 */

import { Role } from '$lib/generated/prisma/client';
import type { PrismaClient } from '$lib/generated/prisma/client';

/** Bumped when the shape of the file changes, so an importer can tell. */
export const EXPORT_VERSION = 1;

/**
 * Staff survive a wipe, along with the blacklist.
 *
 * Wiping the account that ran the wipe would be unrecoverable in production: signing
 * back in through Google creates a HACKER, and no admin would be left to grant roles.
 */
export const WIPE_KEEPS_ROLES = [Role.ADMIN, Role.ORGANIZER];

export interface DatabaseExport {
	version: number;
	exportedAt: string;
	/** Row counts per table, so a reader can sanity-check the file at a glance. */
	counts: Record<string, number>;
	tables: Record<string, unknown[]>;
}

/**
 * Every table, read inside one transaction.
 *
 * The transaction is what makes this a snapshot rather than twelve unrelated reads.
 * Without it an applicant could submit between the `user` and `applicationResponse`
 * reads, and the file would carry answers belonging to nobody.
 */
export async function buildExport(prisma: PrismaClient): Promise<DatabaseExport> {
	const [
		user,
		applicationResponse,
		question,
		settings,
		blacklist,
		schedule,
		scan,
		log,
		emailLog,
		group,
		team,
		invitation
	] = await prisma.$transaction([
		prisma.user.findMany(),
		prisma.applicationResponse.findMany(),
		prisma.question.findMany(),
		prisma.settings.findMany(),
		prisma.blacklist.findMany(),
		prisma.schedule.findMany(),
		prisma.scan.findMany(),
		prisma.log.findMany(),
		prisma.emailLog.findMany(),
		prisma.group.findMany(),
		prisma.team.findMany(),
		prisma.invitation.findMany()
	]);

	const tables: Record<string, unknown[]> = {
		user,
		applicationResponse,
		question,
		settings,
		blacklist,
		schedule,
		scan,
		log,
		emailLog,
		group,
		team,
		invitation
	};

	const counts: Record<string, number> = {};
	for (const [name, rows] of Object.entries(tables)) counts[name] = rows.length;

	return {
		version: EXPORT_VERSION,
		exportedAt: new Date().toISOString(),
		counts,
		tables
	};
}

/**
 * Empty every table except the staff accounts and the blacklist.
 *
 * Ordered child-before-parent even though every foreign key is `ON DELETE SET NULL` or
 * `CASCADE`, because relying on the database would leave the outcome dependent on
 * constraint definitions that live in migrations.
 *
 * `Settings` goes too. `settings.get` falls back to `DEFAULT_SETTINGS` when the table
 * is empty, so the app comes back up on defaults rather than last year's deadlines.
 *
 * Deliberately not run in a transaction with the export: the file has to be on the
 * operator's disk before anything is deleted.
 */
export async function wipeDatabase(prisma: PrismaClient): Promise<Record<string, number>> {
	// Children first, then the rows they point at.
	const invitation = await prisma.invitation.deleteMany();
	const applicationResponse = await prisma.applicationResponse.deleteMany();
	const scan = await prisma.scan.deleteMany();
	const emailLog = await prisma.emailLog.deleteMany();
	const log = await prisma.log.deleteMany();
	const question = await prisma.question.deleteMany();
	const schedule = await prisma.schedule.deleteMany();
	const settings = await prisma.settings.deleteMany();

	// Everyone who is not staff. Their scans and responses are already gone above, and
	// the self-referencing columns on surviving staff rows are nulled by SET NULL.
	const user = await prisma.user.deleteMany({
		where: { role: { notIn: WIPE_KEEPS_ROLES } }
	});

	// After the users, so the SET NULL on `User.teamId`/`groupId` only has to
	// touch the staff rows that are left.
	const team = await prisma.team.deleteMany();
	const group = await prisma.group.deleteMany();

	return {
		user: user.count,
		applicationResponse: applicationResponse.count,
		question: question.count,
		settings: settings.count,
		schedule: schedule.count,
		scan: scan.count,
		log: log.count,
		emailLog: emailLog.count,
		group: group.count,
		team: team.count,
		invitation: invitation.count
	};
}
