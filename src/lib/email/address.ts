import { z } from 'zod';

const schema = z.email();

/**
 * Reports whether a string is a valid email address.
 *
 * The single definition of address validity, shared by the client-side checks and the
 * server's re-check. A second spelling of this rule would surface as an address the UI
 * accepts and the send then refuses.
 *
 * Inputs:
 * - email: string — an address, with no surrounding whitespace
 *
 * Outputs:
 * - boolean — whether the address is valid
 */
export function isValidEmail(email: string): boolean {
	return schema.safeParse(email).success;
}

/**
 * Selects the entries of a pasted or uploaded list that are not addresses.
 *
 * Inputs:
 * - emails: readonly string[] — raw entries, which may carry surrounding whitespace
 *
 * Outputs:
 * - string[] — the offending entries unmodified, so a caller can show the admin what
 *   they typed
 */
export function malformedEmails(emails: readonly string[]): string[] {
	return emails.filter((e) => !isValidEmail(e.trim()));
}
