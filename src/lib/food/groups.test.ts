import { describe, expect, it } from 'vitest';
import { splitFoodPool, foodPoolFor } from './groups';

describe('foodPoolFor', () => {
	it('puts a user with no selected restrictions in NO_RESTRICTION', () => {
		expect(foodPoolFor([])).toBe('NO_RESTRICTION');
	});

	it('puts a user with one restriction in DIETARY_RESTRICTION', () => {
		expect(foodPoolFor(['Vegetarian'])).toBe('DIETARY_RESTRICTION');
	});

	it('puts a user with several restrictions in DIETARY_RESTRICTION', () => {
		expect(foodPoolFor(['Vegetarian', 'Nut allergy'])).toBe('DIETARY_RESTRICTION');
	});
});

describe('splitFoodPool', () => {
	it('keeps teammates together while putting each unit in the smallest group', () => {
		const groups = splitFoodPool(
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
