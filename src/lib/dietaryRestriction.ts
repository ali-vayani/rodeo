/**
 * Normalizes a raw DIETARY_RESTRICTION answer before it's mirrored onto
 * `User.dietaryRestriction`.
 *
 * The question offers "No dietary restrictions" as one of its options so an applicant
 * has something to pick when they have none. Left in the array, it would make the
 * array non-empty and push that person into the dietary pool for food grouping, even
 * though they have no actual restriction. Isomorphic (no Prisma/node imports), same as
 * `linkedFields.ts`, so it can be shared by the live save path, the migration backfill
 * comment, and a standalone backfill script.
 */

export const NO_DIETARY_RESTRICTION_OPTION = 'No dietary restrictions';

/**
 * Drops the "none" placeholder, matched case- and whitespace-insensitively so a stray
 * re-save or a hand-edited row doesn't slip past it. Any real restriction selected
 * alongside it is kept — the real option always wins over the placeholder.
 */
export function normalizeDietaryRestriction(values: readonly string[]): string[] {
	return values.filter(
		(value) => value.trim().toLowerCase() !== NO_DIETARY_RESTRICTION_OPTION.toLowerCase()
	);
}
