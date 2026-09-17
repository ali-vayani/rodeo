/** Deterministic, roughly-even assignment that does not split a teammate unit. */
export type LunchGroupCandidate = {
	uid: string;
	name: string;
	teamId: string | null;
};

/**
 * Which pool an attendee belongs in, based on `User.dietaryRestriction`.
 *
 * Any selected restriction is enough to need the dietary pool; the specific values
 * matter for catering, not for grouping. Returns the literal `LunchGroupPool` values
 * rather than importing the Prisma enum, since this module stays free of generated
 * client code.
 */
export function lunchPoolFor(
	dietaryRestriction: readonly string[]
): 'DIETARY_RESTRICTION' | 'NO_RESTRICTION' {
	return dietaryRestriction.length > 0 ? 'DIETARY_RESTRICTION' : 'NO_RESTRICTION';
}

export function splitLunchPool(
	users: LunchGroupCandidate[],
	groupCount: number
): LunchGroupCandidate[][] {
	const groups = Array.from({ length: groupCount }, () => [] as LunchGroupCandidate[]);
	const units = new Map<string, LunchGroupCandidate[]>();

	for (const user of users) {
		const key = user.teamId ?? `user:${user.uid}`;
		const unit = units.get(key) ?? [];
		unit.push(user);
		units.set(key, unit);
	}

	const ordered = [...units.values()].sort(
		(a, b) => b.length - a.length || a[0].name.localeCompare(b[0].name)
	);
	for (const unit of ordered) {
		const smallest = groups.reduce(
			(best, group, index) => (group.length < groups[best].length ? index : best),
			0
		);
		groups[smallest].push(...unit);
	}

	return groups;
}
