import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));
vi.mock('$app/environment', () => ({ dev: true }));

// The S3 backend is stubbed; `s3.test.ts` covers the SDK itself.
const s3Calls: string[] = [];
vi.mock('./s3', () => ({
	s3Configured: () => Boolean(env.S3_BUCKET),
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
	storageConfigured
} = await import('./storage');

/** All four set is what `s3Configured` keys on; the stub above uses S3_BUCKET. */
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
