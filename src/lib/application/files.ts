/**
 * Whether an answer names a PDF. The name is all we store about a file.
 *
 * The extension is a claim, not proof: the inline download hardcodes `application/pdf`
 * and `nosniff` so a mislabelled file renders as a broken PDF, never as its real type.
 */
export function isPdfFilename(name: string): boolean {
	return name.trim().toLowerCase().endsWith('.pdf');
}

/**
 * The extensions a FILE question accepts. Resume formats — the only thing FILE is used
 * for — so this is a constant rather than a per-question column.
 *
 * Isomorphic on purpose: the `accept` attribute on the file input and the server-side
 * check in `checkUpload` read the same array, because `accept` is only a picker hint and
 * an applicant can pick "All Files" past it.
 */
export const UPLOAD_EXTENSIONS = ['.doc', '.docx', '.pdf'] as const;

/** The `accept` attribute for a file input, e.g. `.doc,.docx,.pdf`. */
export const UPLOAD_ACCEPT = UPLOAD_EXTENSIONS.join(',');

/** Whether a filename claims one of the accepted extensions. */
export function hasAllowedExtension(name: string): boolean {
	const lower = name.trim().toLowerCase();
	return UPLOAD_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/**
 * Where a question's file lives in storage. Derived from the two ids that already
 * identify the answer rather than stored, so there is no key to migrate or forge and
 * re-uploading overwrites in place. The prefix keeps these clear of wallet artwork.
 *
 * Here rather than in `$lib/server/applicationFiles` (which re-exports it) because this
 * module imports nothing: the seed scripts run under tsx with no SvelteKit aliases and
 * need the same format, and a second copy of it is a key that can silently drift.
 */
export function applicationFileKey(userId: string, questionId: string): string {
	return `applications/${userId}/${questionId}`;
}
