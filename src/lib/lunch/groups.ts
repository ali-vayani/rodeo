/** Deterministic, roughly-even assignment that does not split a teammate unit. */
export type LunchGroupCandidate = {
	uid: string;
	name: string;
	teamId: string | null;
};

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
