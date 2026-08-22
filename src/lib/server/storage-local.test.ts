import { describe, it, expect, afterAll } from 'vitest';
import { rm } from 'node:fs/promises';

// The real filesystem, not a mock: this module's job is turning a key into a file.
// Everything goes under a test-only prefix and is removed afterwards.
import {
	UPLOADS_ROOT,
	deleteObject,
	downloadResponse,
	exists,
	getObject,
	localPathFor,
	putObject
} from './storage-local';

const PREFIX = 'test-fixtures';
const key = (name: string) => `${PREFIX}/${name}`;

afterAll(async () => {
	await rm(localPathFor(PREFIX), { recursive: true, force: true });
});

describe('round trip', () => {
	it('stores and reads back the exact bytes', async () => {
		const body = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]);
		await putObject(key('resume.pdf'), body);
		expect(await getObject(key('resume.pdf'))).toEqual(body);
	});

	it('creates the nested directories a derived key implies', async () => {
		// Keys are two levels deep in a tree that does not exist yet.
		await putObject(key('applications/user1/q1'), Buffer.from('x'));
		expect(await exists(key('applications/user1/q1'))).toBe(true);
	});

	it('overwrites in place, like PutObject', async () => {
		// The same answer maps to the same key, so re-uploading must replace.
		await putObject(key('same.pdf'), Buffer.from('first'));
		await putObject(key('same.pdf'), Buffer.from('second'));
		expect((await getObject(key('same.pdf'))).toString()).toBe('second');
	});
});

describe('deleteObject', () => {
	it('removes the file', async () => {
		await putObject(key('gone.pdf'), Buffer.from('x'));
		await deleteObject(key('gone.pdf'));
		expect(await exists(key('gone.pdf'))).toBe(false);
	});

	it('treats a missing key as success, like S3', async () => {
		await expect(deleteObject(key('never-existed.pdf'))).resolves.toBeUndefined();
	});
});

describe('downloadResponse', () => {
	it('serves the bytes as an attachment', async () => {
		await putObject(key('cv.pdf'), Buffer.from('hello'));
		const response = await downloadResponse(key('cv.pdf'), 'Ada Lovelace CV.pdf');

		expect(await response.text()).toBe('hello');
		expect(response.headers.get('content-disposition')).toBe(
			'attachment; filename="Ada Lovelace CV.pdf"'
		);
	});

	it('does not render an uploaded file inline by default', async () => {
		// Keeps an uploaded .html from being stored XSS in the admin's browser.
		await putObject(key('sneaky.html'), Buffer.from('<script>alert(1)</script>'));
		const response = await downloadResponse(key('sneaky.html'), 'sneaky.html');

		expect(response.headers.get('content-type')).toBe('application/octet-stream');
		expect(response.headers.get('content-disposition')).toMatch(/^attachment;/);
	});

	it('renders inline as a PDF when asked, whatever was uploaded', async () => {
		// The route only asks for a `.pdf`, but the name is the applicant's to choose.
		// This HTML has to arrive as a corrupt PDF, not as a script on our origin.
		await putObject(key('liar.pdf'), Buffer.from('<script>alert(1)</script>'));
		const response = await downloadResponse(key('liar.pdf'), 'liar.pdf', { inline: true });

		expect(response.headers.get('content-type')).toBe('application/pdf');
		expect(response.headers.get('content-disposition')).toBe('inline; filename="liar.pdf"');
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
	});

	it('forbids sniffing on an ordinary download too', async () => {
		await putObject(key('cv2.pdf'), Buffer.from('x'));
		const response = await downloadResponse(key('cv2.pdf'), 'cv2.pdf');
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
	});

	it('strips quotes and newlines from the filename', async () => {
		await putObject(key('q.pdf'), Buffer.from('x'));
		const response = await downloadResponse(key('q.pdf'), 'a"b\r\nX-Evil: 1.pdf');
		expect(response.headers.get('content-disposition')).toBe(
			'attachment; filename="abX-Evil: 1.pdf"'
		);
	});
});

describe('keys cannot escape the uploads directory', () => {
	it('refuses a traversing key', async () => {
		expect(() => localPathFor('../../../etc/passwd')).toThrow(/outside/);
		await expect(putObject('../escape.txt', Buffer.from('x'))).rejects.toThrow(/outside/);
	});

	it('resolves an ordinary key inside the root', () => {
		expect(localPathFor('applications/u/q').startsWith(UPLOADS_ROOT)).toBe(true);
	});

	it('refuses a key that climbs out and back in by spelling', () => {
		// `resolve` collapses the path first, so the check is on the destination.
		expect(() => localPathFor('applications/../../outside')).toThrow(/outside/);
	});
});
