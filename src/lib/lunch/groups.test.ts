import { describe, expect, it } from 'vitest';
import { splitLunchPool, lunchPoolFor } from './groups';

describe('lunchPoolFor', () => {
	it('puts a user with no selected restrictions in NO_RESTRICTION', () => {
		expect(lunchPoolFor([])).toBe('NO_RESTRICTION');
	});

	it('puts a user with one restriction in DIETARY_RESTRICTION', () => {
		expect(lunchPoolFor(['Vegetarian'])).toBe('DIETARY_RESTRICTION');
	});

	it('puts a user with several restrictions in DIETARY_RESTRICTION', () => {
		expect(lunchPoolFor(['Vegetarian', 'Nut allergy'])).toBe('DIETARY_RESTRICTION');
	});
});

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
