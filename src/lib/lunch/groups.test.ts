import { describe, expect, it } from 'vitest';
import { splitLunchPool } from './groups';

describe('splitLunchPool', () => {
	it('keeps teammates together while putting each unit in the smallest group', () => {
		const groups = splitLunchPool(
			[
				{ uid: 'a', name: 'Ada', teamId: 'team-1' },
				{ uid: 'b', name: 'Bea', teamId: 'team-1' },
				{ uid: 'c', name: 'Cal', teamId: null },
				{ uid: 'd', name: 'Dee', teamId: null },
				{ uid: 'e', name: 'Eli', teamId: null }
			],
			2
		);

		expect(groups.map((group) => group.length).sort()).toEqual([2, 3]);
		expect(
			groups.some(
				(group) =>
					group.map((user) => user.uid).includes('a') && group.map((user) => user.uid).includes('b')
			)
		).toBe(true);
	});
});
