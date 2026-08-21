import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));
vi.mock('$app/environment', () => ({ dev: true }));

// The S3 backend is stubbed; `s3.test.ts` covers the SDK itself.
const s3Calls: string[] = [];
const S3_VARS = ['S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
vi.mock('./s3', () => ({
	s3Configured: () => S3_VARS.every((name) => Boolean(env[name])),
	missingS3Vars: () => S3_VARS.filter((name) => !env[name]),
	describeS3Failure: (error: unknown) => `s3: ${(error as Error).message}`,
	putObject: async () => void s3Calls.push('put'),
	getObject: async () => {
		s3Calls.push('get');
		return Buffer.from('from-s3');
	},
	deleteObject: async () => void s3Calls.push('delete'),
	signedDownloadUrl: async () => {
		s3Calls.push('sign');
		return 'https://bucket.s3.amazonaws.com/signed';
	}
}));

const localCalls: string[] = [];
vi.mock('./storage-local', () => ({
	UPLOADS_ROOT: '/tmp/uploads',
	putObject: async () => void localCalls.push('put'),
	getObject: async () => {
		localCalls.push('get');
		return Buffer.from('from-disk');
	},
	deleteObject: async () => void localCalls.push('delete'),
	downloadResponse: async () => {
		localCalls.push('download');
		return new Response('bytes');
	}
}));

const {
	NO_STORAGE_MESSAGE,
	deleteObject,
	downloadResponse,
	getObject,
	putObject,
	storageBackend,
	storageConfigured,
	storageFailureReason,
	storageUnavailableReason,
	withStorageDetail
} = await import('./storage');

/** All four set is what `s3Configured` keys on, in the stub above as in the module. */
function withBucket() {
	env.S3_REGION = 'us-east-1';
	env.S3_BUCKET = 'rodeo-v2-uploads';
	env.S3_ACCESS_KEY_ID = 'AKIAEXAMPLE';
	env.S3_SECRET_ACCESS_KEY = 'secret';
}

beforeEach(() => {
	for (const key of Object.keys(env)) delete env[key];
	s3Calls.length = 0;
	localCalls.length = 0;
	vi.stubEnv('NODE_ENV', 'development');
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe('storageBackend', () => {
	it('is the disk in development with no bucket', () => {
		// The gap this closes: no AWS account previously meant a 503 on every upload.
		expect(storageBackend()).toBe('local');
		expect(storageConfigured()).toBe(true);
	});

	it('is the bucket in development once the variables are set', () => {
		withBucket();
		expect(storageBackend()).toBe('s3');
	});

	it('is the bucket in preview and production', () => {
		withBucket();
		for (const vercelEnv of ['preview', 'production']) {
			env.VERCEL_ENV = vercelEnv;
			expect(storageBackend()).toBe('s3');
		}
	});

	it('NEVER falls back to the disk on a deploy', () => {
		// Serverless filesystems are ephemeral: writing resumes there would lose them
		// and look like it worked.
		for (const vercelEnv of ['preview', 'production']) {
			env.VERCEL_ENV = vercelEnv;
			expect(storageBackend()).toBe('none');
			expect(storageConfigured()).toBe(false);
		}
	});

	it('treats a half-configured bucket on a deploy as no storage', () => {
		env.VERCEL_ENV = 'production';
		env.S3_REGION = 'us-east-1';
		expect(storageBackend()).toBe('none');
	});
});

describe('dispatch', () => {
	it('routes every operation to S3 when a bucket is configured', async () => {
		withBucket();
		await putObject('k', Buffer.from('x'), 'text/plain');
		await getObject('k');
		await deleteObject('k');
		expect(s3Calls).toEqual(['put', 'get', 'delete']);
		expect(localCalls).toEqual([]);
	});

	it('routes every operation to disk in development', async () => {
		await putObject('k', Buffer.from('x'), 'text/plain');
		await getObject('k');
		await deleteObject('k');
		expect(localCalls).toEqual(['put', 'get', 'delete']);
		expect(s3Calls).toEqual([]);
	});

	it('refuses every operation when there is no storage at all', async () => {
		env.VERCEL_ENV = 'production';
		await expect(putObject('k', Buffer.from('x'), 'text/plain')).rejects.toThrow(
			NO_STORAGE_MESSAGE
		);
		await expect(getObject('k')).rejects.toThrow(/S3_BUCKET/);
		await expect(deleteObject('k')).rejects.toThrow(/S3_BUCKET/);
		await expect(downloadResponse('k', 'f.pdf')).rejects.toThrow(/S3_BUCKET/);
	});
});

describe('downloadResponse', () => {
	it('redirects to a presigned URL when backed by a bucket', async () => {
		withBucket();
		const response = await downloadResponse('k', 'resume.pdf');
		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe('https://bucket.s3.amazonaws.com/signed');
		expect(s3Calls).toEqual(['sign']);
	});

	it('does not let anything cache the presigned URL', async () => {
		withBucket();
		const response = await downloadResponse('k', 'resume.pdf');
		expect(response.headers.get('cache-control')).toBe('private, no-store');
	});

	it('serves the bytes directly when backed by disk', async () => {
		// Nothing to presign and no host to point at — hence the Response interface.
		const response = await downloadResponse('k', 'resume.pdf');
		expect(response.status).toBe(200);
		expect(await response.text()).toBe('bytes');
		expect(localCalls).toEqual(['download']);
	});
});

describe('storageUnavailableReason', () => {
	it('is null wherever uploads work', () => {
		// Development, on disk...
		expect(storageUnavailableReason()).toBeNull();
		// ...and a deploy with a bucket.
		withBucket();
		env.VERCEL_ENV = 'production';
		expect(storageUnavailableReason()).toBeNull();
	});

	it('names every variable a deploy is missing', () => {
		env.VERCEL_ENV = 'production';
		expect(storageUnavailableReason()).toBe(
			'S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY not set'
		);
	});

	it('names only the one that is missing when the rest are set', () => {
		// The case a generic message hides: three of four is a typo, not an off switch.
		withBucket();
		delete env.S3_SECRET_ACCESS_KEY;
		env.VERCEL_ENV = 'preview';
		expect(storageUnavailableReason()).toBe('S3_SECRET_ACCESS_KEY not set');
	});
});

describe('storageFailureReason', () => {
	it('reads an S3 rejection through the S3 backend', () => {
		withBucket();
		expect(storageFailureReason(new Error('denied'))).toBe('s3: denied');
	});

	it('is the plain message on disk', () => {
		expect(storageFailureReason(new Error('ENOENT'))).toBe('ENOENT');
	});
});

describe('withStorageDetail', () => {
	it('tells preview and development what is wrong', () => {
		// Whoever reads this response is the person who can fix the deploy.
		for (const vercelEnv of ['preview', 'development']) {
			env.VERCEL_ENV = vercelEnv;
			expect(withStorageDetail('Uploads are off.', 'S3_BUCKET not set')).toBe(
				'Uploads are off. (S3_BUCKET not set)'
			);
		}
	});

	it('tells production nothing about the environment', () => {
		// An applicant cannot act on a variable name and should not be handed one.
		env.VERCEL_ENV = 'production';
		expect(withStorageDetail('Uploads are off.', 'S3_BUCKET not set')).toBe('Uploads are off.');
	});
});
