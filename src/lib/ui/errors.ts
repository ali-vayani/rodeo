/**
 * Reading a caught value.
 *
 * `catch (e)` gives `unknown`, which is correct — anything can be thrown — but
 * every call site was reaching for `e.message` through an `any` annotation to
 * get at it. These two helpers do the narrowing once so the annotations can go.
 */

/**
 * The message from a caught value, or `fallback` when it has none worth showing.
 *
 * Matches on shape rather than `instanceof Error`: a tRPC client error arrives
 * structurally-cloned across the network boundary and does not survive as an
 * `Error` instance, so an instanceof check would silently drop every server
 * message the user actually needs to read.
 */
export function errorMessage(error: unknown, fallback: string): string {
	if (typeof error === 'object' && error !== null && 'message' in error) {
		const message = (error as { message?: unknown }).message;
		if (typeof message === 'string' && message) return message;
	}
	return fallback;
}

/**
 * Whether a caught value is a tRPC error carrying `code`.
 *
 * The client puts the procedure's `TRPCError` code at `error.data.code`, which
 * is how a caller distinguishes "someone else holds this lock" (`CONFLICT`) from
 * a generic failure.
 */
export function isTRPCErrorCode(error: unknown, code: string): boolean {
	if (typeof error !== 'object' || error === null || !('data' in error)) return false;
	const data = (error as { data?: unknown }).data;
	return typeof data === 'object' && data !== null && (data as { code?: unknown }).code === code;
}
