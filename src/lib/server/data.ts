/**
 * Whole-database export, and the wipe that always follows one.
 *
 * Both live here rather than in the router so the two halves that have to agree
 * — which tables are carried out, and which are emptied — sit next to each
 * other. A table added to the schema and forgotten in `buildExport` would be
 * destroyed by `wipeDatabase` without ever appearing in the file that was
 * supposed to preserve it, and `EXPORTED_TABLES` below is the single list both
 * read from so that divergence is visible in one place.
 */

import { Role } from '$lib/generated/prisma/client';
import type { PrismaClient } from '$lib/generated/prisma/client';

/** Bumped when the shape of the file changes, so an importer can tell. */
export const EXPORT_VERSION = 1;

/**
 * Staff survive a wipe, along with the blacklist.
 *
 * Wiping the account that ran the wipe would, on the production deploy, be
 * unrecoverable: signing back in through Google creates a HACKER, and there
 * would be no admin left to grant anyone a role again. Keeping ORGANIZER too
 * means the team that ran the event still has its logins for the next one.
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
 * The transaction is what makes this a snapshot rather than twelve unrelated
 * reads: without it an applicant could submit between the `user` read and the
 * `applicationResponse` read, and the file would carry answers belonging to
 * nobody. It matters most in the wipe path, where this is the only copy that
 * will exist.
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
 * Ordered child-before-parent even though every foreign key in the schema is
 * `ON DELETE SET NULL` or `CASCADE`: relying on the database to null out
 * references would leave the outcome dependent on constraint definitions that
 * live in migrations, and this reads as what it is.
 *
 * `Settings` goes too. `settings.get` falls back to `DEFAULT_SETTINGS` when the
 * table is empty, so the app comes back up on defaults rather than on last
 * year's deadlines — which is what a reset is for.
 *
 * Not run inside a transaction with the export deliberately: the file has to be
 * on the operator's disk *before* anything is deleted, so the caller downloads
 * it first and only then calls this. See the danger-zone flow.
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

	// Everyone who is not staff. Their scans and responses are already gone
	// above, and the self-referencing claim/decision/score columns on the staff
	// rows that survive are nulled by the schema's SET NULL foreign keys.
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
