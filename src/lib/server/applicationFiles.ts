/**
 * The rules behind application file uploads, kept out of the route handlers.
 *
 * Two `+server.ts` endpoints use this, and this repo has no handler tests — so
 * everything with a decision in it lives here, where it is covered.
 */

import { Role, UserStatus } from '$lib/generated/prisma/client';
import { UPLOAD_EXTENSIONS, hasAllowedExtension } from '$lib/application/files';
import { MAX_UPLOAD_BYTES } from './s3';

/**
 * Where a question's file lives in the bucket. Derived from the two ids that already
 * identify the answer rather than stored, so there is no key to migrate or forge and
 * re-uploading overwrites in place. The prefix keeps these clear of wallet artwork.
 */
export function applicationFileKey(userId: string, questionId: string): string {
	return `applications/${userId}/${questionId}`;
}

export type UploadRejection = { message: string; status: 400 | 413 };

/**
 * Whether these bytes may be stored. Returns the reason rather than throwing, so the
 * caller picks the status code.
 *
 * The extension is checked, not the content type: a browser reports whatever it guessed
 * from the same extension, so sniffing `file.type` would ask the client twice rather
 * than once. It is a claim either way — the point is to catch the applicant who
 * attached the wrong thing, not to stop one who is lying. Every download is served as
 * an attachment regardless.
 */
export function checkUpload(file: { size: number; name: string }): UploadRejection | null {
	if (file.size === 0) {
		return { message: 'That file is empty.', status: 400 };
	}

	if (file.size > MAX_UPLOAD_BYTES) {
		const limit = Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024));
		return {
			message: `That file is ${formatSize(file.size)}. The limit is ${limit} MB.`,
			status: 413
		};
	}

	if (file.name.trim() === '') {
		return { message: 'That file has no name.', status: 400 };
	}

	if (!hasAllowedExtension(file.name)) {
		return {
			message: `That file must be one of ${UPLOAD_EXTENSIONS.join(', ')}.`,
			status: 400
		};
	}

	return null;
}

function formatSize(bytes: number): string {
	const mb = bytes / (1024 * 1024);
	return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export type UploaderState = { uid: string; status: UserStatus; role: Role };

/**
 * Whether an applicant may upload against a question right now — the same two
 * conditions `application.save` enforces for every other answer, so a file cannot be
 * attached to an application a text answer could not be.
 *
 * The application window is not checked here: it lives on the Settings row the caller
 * has already loaded, and a second copy of the date comparison is how the two drift.
 */
export function uploadRefusal(
	user: UploaderState,
	question: { targetRole: Role[] }
): string | null {
	if (user.status !== UserStatus.CREATED) {
		return 'Your application has already been submitted and can no longer be edited.';
	}

	if (question.targetRole.length > 0 && !question.targetRole.includes(user.role)) {
		return 'This question was not asked of you.';
	}

	return null;
}

/**
 * Whether a viewer may download an applicant's file: the applicant themselves, or an
 * ADMIN. ORGANIZER is excluded deliberately — `permissions.ts` keeps them out of
 * /admin/users and /admin/admissions, so this would be a side door into that data.
 */
export function canDownloadApplicationFile(
	viewer: { uid: string; role: Role },
	ownerId: string
): boolean {
	return viewer.uid === ownerId || viewer.role === Role.ADMIN;
}
