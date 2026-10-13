import { describe, it, expect } from 'vitest';
import {
	attachmentRefSchema,
	checkAttachmentUpload,
	emailAttachmentKey,
	storedAttachmentRefs
} from './emailAttachments';
import { MAX_EMAIL_ATTACHMENT_BYTES } from '$lib/email/attachments';

function refFor(key: string) {
	return { key, filename: 'schedule.pdf', contentType: 'application/pdf', size: 1234 };
}

describe('attachmentRefSchema', () => {
	it('accepts exactly the keys the server mints', () => {
		expect(attachmentRefSchema.safeParse(refFor(emailAttachmentKey())).success).toBe(true);
	});

	it('rejects keys pointing anywhere else in the bucket', () => {
		// The reason the pattern exists: without it, a hand-written startSend call could
		// mail any object storage holds — an applicant's resume, say.
		for (const key of [
			'applications/user-1/question-1',
			'email-attachments/../applications/user-1/question-1',
			'email-attachments/',
			'email-attachments/not-a-uuid',
			`${emailAttachmentKey()}/deeper`
		]) {
			expect(attachmentRefSchema.safeParse(refFor(key)).success).toBe(false);
		}
	});

	it('rejects a size past the per-file cap', () => {
		const ref = { ...refFor(emailAttachmentKey()), size: MAX_EMAIL_ATTACHMENT_BYTES + 1 };
		expect(attachmentRefSchema.safeParse(ref).success).toBe(false);
	});
});

describe('checkAttachmentUpload', () => {
	it('accepts an ordinary file, whatever its extension', () => {
		// Unlike application uploads there is no extension allowlist: the uploader is an
		// admin choosing what to mail.
		expect(checkAttachmentUpload({ size: 1024, name: 'invite.ics' })).toBeNull();
	});

	it('rejects empty, oversized and nameless files', () => {
		expect(checkAttachmentUpload({ size: 0, name: 'a.pdf' })?.status).toBe(400);
		expect(
			checkAttachmentUpload({ size: MAX_EMAIL_ATTACHMENT_BYTES + 1, name: 'a.pdf' })?.status
		).toBe(413);
		expect(checkAttachmentUpload({ size: 10, name: '  ' })?.status).toBe(400);
	});
});

describe('storedAttachmentRefs', () => {
	it('reads back what startSend stored', () => {
		const refs = [refFor(emailAttachmentKey())];
		expect(storedAttachmentRefs(refs)).toEqual(refs);
	});

	it('returns an empty list for rows that predate attachments or hold junk', () => {
		expect(storedAttachmentRefs([])).toEqual([]);
		expect(storedAttachmentRefs(null)).toEqual([]);
		expect(storedAttachmentRefs('{}')).toEqual([]);
		expect(storedAttachmentRefs([{ key: 'applications/u/q' }])).toEqual([]);
	});
});
