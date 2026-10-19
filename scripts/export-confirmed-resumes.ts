/**
 * Downloads all resumes for CONFIRMED hackers and zips them into confirmed-resumes.zip.
 *
 * Usage:
 *   npx tsx scripts/export-confirmed-resumes.ts
 *
 * Requires in .env (or environment):
 *   DATABASE_URL, DATABASE_SCHEMA (if using a non-public schema)
 *   AWS_REGION, S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
 *
 * Output: confirmed-resumes.zip in the current working directory.
 * Each file is named "{sanitised name} - {email}.{ext}".
 */

import { config } from 'dotenv';
// Load .env.local first (Vercel CLI pulls here), then fall back to .env
config({ path: '.env.local' });
config();
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Role, UserStatus } from '../src/lib/generated/prisma/client';
import { createPrismaClient } from '../prisma/seedShared.ts';

function applicationFileKey(userId: string, questionId: string): string {
	return `applications/${userId}/${questionId}`;
}

function sanitiseName(name: string): string {
	// Keep only characters safe for filenames
	return name.replace(/[/\\:*?"<>|]/g, '_').trim() || 'unknown';
}

// The resume question ID — hard-coded so the script doesn't rely on a DB lookup
// that could resolve to the wrong schema/environment.
const RESUME_QUESTION_ID = 'c5b5fc2ba322548b0a142ce42';

async function main() {
	const {
		DATABASE_URL,
		DIRECT_URL,
		AWS_REGION,
		S3_BUCKET,
		AWS_ACCESS_KEY_ID,
		AWS_SECRET_ACCESS_KEY
	} = process.env;

	// Prefer DIRECT_URL (bypasses the Supabase pooler) for scripts that do a full scan.
	const dbUrl = DIRECT_URL ?? DATABASE_URL;
	if (!dbUrl) throw new Error('DIRECT_URL or DATABASE_URL is required');
	if (!AWS_REGION || !S3_BUCKET || !AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
		throw new Error(
			'AWS_REGION, S3_BUCKET, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are all required'
		);
	}
	if (AWS_SECRET_ACCESS_KEY === '[SENSITIVE]') {
		throw new Error(
			'AWS_SECRET_ACCESS_KEY is still the [SENSITIVE] placeholder — copy the real value from the Vercel dashboard into .env.local'
		);
	}

	const prisma = createPrismaClient(dbUrl);
	const s3 = new S3Client({
		region: AWS_REGION,
		credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY }
	});

	const qidFlag = process.argv.indexOf('--question-id');
	const questionId = qidFlag !== -1 ? process.argv[qidFlag + 1] : RESUME_QUESTION_ID;
	console.log(`Using resume question ID: ${questionId}`);

	// Fetch all confirmed hackers that have submitted a resume for this question
	const users = await prisma.user.findMany({
		where: {
			role: Role.HACKER,
			status: UserStatus.CONFIRMED,
			application: {
				some: { questionId }
			}
		},
		select: {
			uid: true,
			name: true,
			email: true,
			application: {
				where: { questionId },
				select: { value: true }
			}
		}
	});

	console.log(`Found ${users.length} confirmed hackers with a resume.`);
	if (users.length === 0) {
		console.log('Nothing to do.');
		return;
	}

	// Prepare a temp directory
	const tmpDir = join(process.cwd(), '.resume-export-tmp');
	if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
	mkdirSync(tmpDir);

	let downloaded = 0;
	let skipped = 0;

	for (const user of users) {
		const filename = user.application[0]?.value;
		if (!filename) {
			console.warn(`  [skip] ${user.email} — no filename stored`);
			skipped++;
			continue;
		}

		const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';
		const safeName = `${sanitiseName(user.name)} - ${user.email}${ext}`;
		const key = applicationFileKey(user.uid, questionId!);

		try {
			const response = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
			if (!response.Body) throw new Error('Empty S3 response body');
			const bytes = Buffer.from(await response.Body.transformToByteArray());
			writeFileSync(join(tmpDir, safeName), bytes);
			console.log(`  [ok] ${safeName}`);
			downloaded++;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(`  [skip] ${user.email} — S3 error: ${msg}`);
			skipped++;
		}
	}

	// Zip the temp directory
	const outZip = join(process.cwd(), 'confirmed-resumes.zip');
	if (existsSync(outZip)) rmSync(outZip);
	execSync(`zip -j "${outZip}" "${tmpDir}"/*`);
	rmSync(tmpDir, { recursive: true });

	console.log(`\nDone. ${downloaded} resumes zipped → confirmed-resumes.zip`);
	if (skipped > 0) console.log(`${skipped} skipped (see warnings above).`);

	await prisma.$disconnect();
	s3.destroy();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err: unknown) => {
		console.error(err instanceof Error ? err.message : String(err));
		process.exitCode = 1;
	});
}
