import { describe, it, expect, vi, beforeEach } from 'vitest';

const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));

/** Every `S3Client` the module constructs, in order, with the config it was handed. */
const constructions: Array<Record<string, unknown>> = [];
/** Every command sent, in order. Identified by `constructor.name`. */
const sent: Array<{ constructor: { name: string }; input: Record<string, unknown> }> = [];
/** What the next `send` resolves to. Only `getObject` cares. */
let sendResult: unknown = {};

vi.mock('@aws-sdk/client-s3', () => {
	class Command {
		constructor(public input: Record<string, unknown>) {}
	}
	class PutObjectCommand extends Command {}
	class GetObjectCommand extends Command {}
	class DeleteObjectCommand extends Command {}

	class S3Client {
		constructor(config: Record<string, unknown>) {
			constructions.push(config);
		}
		send(command: { constructor: { name: string }; input: Record<string, unknown> }) {
			sent.push(command);
			return Promise.resolve(sendResult);
		}
	}

	return { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand };
});

const presigned: Array<{
	command: { input: Record<string, unknown> };
	options: { expiresIn?: number };
}> = [];

vi.mock('@aws-sdk/s3-request-presigner', () => ({
	getSignedUrl: (
		_client: unknown,
		command: { input: Record<string, unknown> },
		options: { expiresIn?: number }
	) => {
		presigned.push({ command, options });
		return Promise.resolve('https://bucket.s3.amazonaws.com/signed');
	}
}));

const {
	MAX_UPLOAD_BYTES,
	NO_STORAGE_MESSAGE,
	deleteObject,
	describeS3Failure,
	missingS3Vars,
	getObject,
	putObject,
	resetS3Client,
	s3Config,
	s3ConfigWarnings,
	s3Configured,
	signedDownloadUrl
} = await import('./s3');

function configure() {
	env.AWS_REGION = 'us-east-1';
	env.S3_BUCKET = 'rodeo-v2-uploads';
	env.AWS_ACCESS_KEY_ID = 'AKIAEXAMPLE';
	env.AWS_SECRET_ACCESS_KEY = 'secret';
}

beforeEach(() => {
	for (const key of Object.keys(env)) delete env[key];
	constructions.length = 0;
	sent.length = 0;
	presigned.length = 0;
	sendResult = {};
	resetS3Client();
});

describe('s3Config', () => {
	it('is null when nothing is set', () => {
		expect(s3Config()).toBeNull();
		expect(s3Configured()).toBe(false);
	});

	it('is null when only some variables are set', () => {
		env.AWS_REGION = 'us-east-1';
		env.S3_BUCKET = 'rodeo-v2-uploads';
		expect(s3Config()).toBeNull();
	});

	it('treats a variable created-but-left-blank as absent', () => {
		// A Vercel variable added and never filled in arrives as ''. Passing that
		// through would produce a client with an empty bucket name that fails on
		// every request instead of a feature that is simply switched off.
		configure();
		env.S3_BUCKET = '';
		expect(s3Config()).toBeNull();
	});

	it('reads all four when they are present', () => {
		configure();
		expect(s3Config()).toEqual({
			region: 'us-east-1',
			bucket: 'rodeo-v2-uploads',
			accessKeyId: 'AKIAEXAMPLE',
			secretAccessKey: 'secret'
		});
		expect(s3Configured()).toBe(true);
	});
});

describe('the client is never left to the default credential chain', () => {
	it('passes the region and credentials explicitly', async () => {
		// These share their names with the Lambda execution role's own variables, so
		// passing them is what separates our key from the platform's: an SDK left to
		// resolve credentials itself would sooner or later authenticate as the function
		// against the wrong bucket, silently rather than erroring.
		configure();

		await deleteObject('applications/user/question');

		expect(constructions).toHaveLength(1);
		expect(constructions[0].region).toBe('us-east-1');
		expect(constructions[0].credentials).toEqual({
			accessKeyId: 'AKIAEXAMPLE',
			secretAccessKey: 'secret'
		});
	});

	it('reuses one client across calls', async () => {
		configure();
		await deleteObject('a');
		await deleteObject('b');
		expect(constructions).toHaveLength(1);
	});

	it('rebuilds when the configuration changes underneath it', async () => {
		// A frozen client is what capturing config at import would produce. Under
		// `vite preview` and in tests the environment is populated after load.
		configure();
		await deleteObject('a');
		env.S3_BUCKET = 'a-different-bucket';
		await deleteObject('b');
		expect(constructions).toHaveLength(2);
	});
});

describe('operations without a bucket', () => {
	it('name the variables to set rather than failing obscurely', async () => {
		await expect(putObject('k', Buffer.from('x'), 'text/plain')).rejects.toThrow(
			NO_STORAGE_MESSAGE
		);
		await expect(getObject('k')).rejects.toThrow(/S3_BUCKET/);
		await expect(deleteObject('k')).rejects.toThrow(/S3_BUCKET/);
		await expect(signedDownloadUrl('k')).rejects.toThrow(/S3_BUCKET/);
	});
});

describe('putObject', () => {
	it('sends one PutObject with the bucket, key, body and content type', async () => {
		configure();
		const body = Buffer.from('%PDF-1.4');
		await putObject('applications/user1/q1', body, 'application/pdf');

		expect(sent).toHaveLength(1);
		expect(sent[0].constructor.name).toBe('PutObjectCommand');
		expect(sent[0].input).toEqual({
			Bucket: 'rodeo-v2-uploads',
			Key: 'applications/user1/q1',
			Body: body,
			ContentType: 'application/pdf'
		});
	});

	it('does not delete before writing', async () => {
		// The previous Rodeo's `s3Upload` issued an unawaited DeleteObjectCommand
		// first, which could land after the write it was meant to precede and remove
		// the file that had just been uploaded. PutObject already replaces the key.
		configure();
		await putObject('k', Buffer.from('x'), 'text/plain');
		expect(sent.map((command) => command.constructor.name)).toEqual(['PutObjectCommand']);
	});
});

describe('getObject', () => {
	it('returns the body as a Buffer', async () => {
		configure();
		sendResult = {
			Body: { transformToByteArray: () => Promise.resolve(new Uint8Array([1, 2, 3])) }
		};

		const result = await getObject('ticket.pass/icon.png');
		expect(sent[0].constructor.name).toBe('GetObjectCommand');
		expect(sent[0].input).toEqual({ Bucket: 'rodeo-v2-uploads', Key: 'ticket.pass/icon.png' });
		expect(result).toEqual(Buffer.from([1, 2, 3]));
	});

	it('names the key when the response has no body', async () => {
		configure();
		sendResult = {};
		await expect(getObject('ticket.pass/icon.png')).rejects.toThrow('ticket.pass/icon.png');
	});
});

describe('deleteObject', () => {
	it('sends a DeleteObject for the key', async () => {
		configure();
		await deleteObject('applications/user1/q1');
		expect(sent[0].constructor.name).toBe('DeleteObjectCommand');
		expect(sent[0].input).toEqual({
			Bucket: 'rodeo-v2-uploads',
			Key: 'applications/user1/q1'
		});
	});
});

describe('signedDownloadUrl', () => {
	it('expires in a minute by default', async () => {
		// The URL is unauthenticated for as long as it lives, and the browser follows
		// it immediately. The SDK default the previous Rodeo took is 900 seconds.
		configure();
		await signedDownloadUrl('applications/user1/q1');
		expect(presigned[0].options.expiresIn).toBe(60);
	});

	it('honours an explicit expiry', async () => {
		configure();
		await signedDownloadUrl('k', { expiresIn: 300 });
		expect(presigned[0].options.expiresIn).toBe(300);
	});

	it('names the download after the uploaded file', async () => {
		// Our keys are ids. Without this the browser saves the file as a bare cuid
		// with no extension, which is how the previous Rodeo's resumes arrived.
		configure();
		await signedDownloadUrl('applications/user1/q1', { filename: 'Ada Lovelace CV.pdf' });
		expect(presigned[0].command.input.ResponseContentDisposition).toBe(
			'attachment; filename="Ada Lovelace CV.pdf"'
		);
	});

	it('omits the disposition when no filename is given', async () => {
		configure();
		await signedDownloadUrl('k');
		expect(presigned[0].command.input).not.toHaveProperty('ResponseContentDisposition');
	});

	it('strips quotes, newlines and separators from the filename', async () => {
		// The name comes from a user-supplied upload and is interpolated into an HTTP
		// header: a quote ends the parameter early, a CRLF ends the header itself.
		configure();
		await signedDownloadUrl('k', { filename: 'a"b\r\nX-Evil: 1\n../c/d.pdf' });
		expect(presigned[0].command.input.ResponseContentDisposition).toBe(
			'attachment; filename="abX-Evil: 1.._c_d.pdf"'
		);
	});

	it('falls back to a placeholder when nothing survives sanitisation', async () => {
		configure();
		await signedDownloadUrl('k', { filename: '"""' });
		expect(presigned[0].command.input.ResponseContentDisposition).toBe(
			'attachment; filename="download"'
		);
	});

	it('returns the signed URL', async () => {
		configure();
		expect(await signedDownloadUrl('k')).toBe('https://bucket.s3.amazonaws.com/signed');
	});
});

describe('s3ConfigWarnings', () => {
	it('says nothing when nothing is set', () => {
		// Absent is a deliberate off switch, not a mistake.
		expect(s3ConfigWarnings()).toEqual([]);
	});

	it('says nothing when everything is set', () => {
		configure();
		expect(s3ConfigWarnings()).toEqual([]);
	});

	it('names the missing variables when half-configured', () => {
		configure();
		delete env.AWS_SECRET_ACCESS_KEY;
		delete env.S3_BUCKET;

		const [warning] = s3ConfigWarnings();
		expect(warning).toContain('S3_BUCKET');
		expect(warning).toContain('AWS_SECRET_ACCESS_KEY');
		expect(warning).not.toContain('AWS_REGION,');
	});
});

describe('missingS3Vars', () => {
	it('is all four when nothing is set', () => {
		expect(missingS3Vars()).toEqual([
			'AWS_REGION',
			'S3_BUCKET',
			'AWS_ACCESS_KEY_ID',
			'AWS_SECRET_ACCESS_KEY'
		]);
	});

	it('is empty once the bucket is configured', () => {
		configure();
		expect(missingS3Vars()).toEqual([]);
	});

	it('names only what is actually missing', () => {
		configure();
		delete env.AWS_REGION;
		expect(missingS3Vars()).toEqual(['AWS_REGION']);
	});
});

describe('describeS3Failure', () => {
	/** The SDK reports a rejection by `name`; these are the ones with one cause each. */
	function rejection(name: string): Error {
		const error = new Error('The request signature we calculated does not match.');
		error.name = name;
		return error;
	}

	it('points a bad key at the variable holding it', () => {
		expect(describeS3Failure(rejection('InvalidAccessKeyId'))).toContain('AWS_ACCESS_KEY_ID');
		expect(describeS3Failure(rejection('SignatureDoesNotMatch'))).toContain(
			'AWS_SECRET_ACCESS_KEY'
		);
	});

	it('points a missing bucket and a wrong region at theirs', () => {
		expect(describeS3Failure(rejection('NoSuchBucket'))).toContain('S3_BUCKET');
		expect(describeS3Failure(rejection('PermanentRedirect'))).toContain('AWS_REGION');
	});

	it('names the SDK error alongside the cause, so the mapping can be checked', () => {
		expect(describeS3Failure(rejection('AccessDenied'))).toContain('(AccessDenied)');
	});

	it("reads the platform's own Lambda credentials as a missing key", () => {
		// Those are temporary and rejected without a session token, which is what a
		// deploy that never set AWS_ACCESS_KEY_ID ends up sending.
		expect(describeS3Failure(rejection('InvalidClientTokenId'))).toContain('AWS_ACCESS_KEY_ID');
	});

	it('passes an unrecognised failure through rather than guessing', () => {
		const unknown = rejection('TimeoutError');
		expect(describeS3Failure(unknown)).toBe(`TimeoutError: ${unknown.message}`);
	});

	it('survives something that is not an Error', () => {
		expect(describeS3Failure('socket hang up')).toBe('socket hang up');
	});
});

describe('MAX_UPLOAD_BYTES', () => {
	it('stays under the 4.5 MB Vercel caps a function request body at', () => {
		// Above that the platform rejects the request with a 413 before any of our
		// code runs, so a larger limit here would be a promise we cannot keep.
		expect(MAX_UPLOAD_BYTES).toBeLessThan(4.5 * 1024 * 1024);
	});
});

describe('storage is never boot-critical', () => {
	it('still boots in production with no bucket configured at all', async () => {
		// The contract from the header comment on ./s3.ts, and the same one
		// wallet/config.ts keeps. Uploads are one question on a form; they must not
		// be able to take the form down with them.
		env.VERCEL_ENV = 'production';
		env.DATABASE_URL = 'postgresql://user:pass@db.example.com:5432/rodeo';
		env.SUPABASE_URL = 'https://project.supabase.co';
		env.SUPABASE_ANON_KEY = 'anon-key';
		env.RESEND_API_KEY = 'resend-key';

		const { validateEnv } = await import('$lib/server/env');
		expect(() => validateEnv()).not.toThrow();
	});
});
