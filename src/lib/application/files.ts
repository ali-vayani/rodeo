/**
 * Whether an answer names a PDF. The name is all we store about a file.
 *
 * The extension is a claim, not proof: the inline download hardcodes `application/pdf`
 * and `nosniff` so a mislabelled file renders as a broken PDF, never as its real type.
 */
export function isPdfFilename(name: string): boolean {
	return name.trim().toLowerCase().endsWith('.pdf');
}
