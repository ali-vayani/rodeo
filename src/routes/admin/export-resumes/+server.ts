/**
 * Bulk resume download for confirmed hackers.
 *
 * Streams a ZIP of every confirmed hacker's resume, named
 * {firstName}_{lastName}.{ext}. Requires staff access.
 */

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { zipSync, strToU8 } from 'fflate';
import { prisma } from '$lib/server/db';
import { getObject } from '$lib/server/storage';
import { isStaff } from '$lib/auth/permissions';
import { applicationFileKey } from '$lib/server/applicationFiles';
import { Role, UserStatus } from '$lib/generated/prisma/enums';

const RESUME_QUESTION_ID = 'c5b5fc2ba322548b0a142ce42';

export const GET: RequestHandler = async ({ locals }) => {
	const viewer = locals.user;
	if (!viewer) error(401, 'Sign in to access this.');
	if (!isStaff(viewer.role)) error(403, 'Staff only.');

	const users = await prisma.user.findMany({
		where: {
			role: Role.HACKER,
			status: UserStatus.CONFIRMED,
			application: { some: { questionId: RESUME_QUESTION_ID } }
		},
		select: {
			uid: true,
			name: true,
			application: {
				where: { questionId: RESUME_QUESTION_ID },
				select: { value: true }
			}
		}
	});

	const files: Record<string, Uint8Array> = {};
	const seen = new Set<string>();

	for (const user of users) {
		const filename = user.application[0]?.value;
		if (!filename) continue;

		const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';
		const [first = '', ...rest] = user.name.trim().split(' ');
		const last = rest.join(' ');
		const base = `${sanitise(first)}_${sanitise(last)}${ext}`;

		// Deduplicate: if two hackers have the same name, append a counter.
		let zipName = base;
		let counter = 2;
		while (seen.has(zipName)) {
			zipName = `${sanitise(first)}_${sanitise(last)}_${counter}${ext}`;
			counter++;
		}
		seen.add(zipName);

		try {
			const bytes = await getObject(applicationFileKey(user.uid, RESUME_QUESTION_ID));
			files[zipName] = bytes;
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			console.warn(`[export-resumes] Skipping ${user.name} (${user.uid}): ${msg}`);
		}
	}

	if (Object.keys(files).length === 0) {
		// Return an empty zip with a readme so the download isn't a silent failure.
		files['README.txt'] = strToU8('No confirmed hacker resumes found.');
	}

	const zip = zipSync(files);

	return new Response(zip, {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': 'attachment; filename="confirmed-resumes.zip"',
			'Content-Length': String(zip.byteLength)
		}
	});
};

function sanitise(s: string): string {
	return s.replace(/[^a-zA-Z0-9-]/g, '_') || 'unknown';
}
