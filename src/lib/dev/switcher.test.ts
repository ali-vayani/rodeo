import { describe, it, expect } from 'vitest';
import type { DecisionStatus, Role, UserStatus } from '$lib/generated/prisma/enums';
import {
	clampPosition,
	decisionOptions,
	FILTERS_KEY,
	filterAccounts,
	indexAccounts,
	loadFilters,
	loadPosition,
	NO_DECISION,
	POSITION_KEY,
	primaryRole,
	saveFilters,
	savePosition,
	sortAccounts,
	type DecisionFilterValue,
	type DevAccount,
	type Position,
	type StoredFilters
} from './switcher';

function account(overrides: Partial<DevAccount> & { email: string }): DevAccount {
	return {
		uid: overrides.email,
		name: 'Test Person',
		roles: ['HACKER'] as Role[],
		status: 'APPLIED' as UserStatus,
		activeDecision: null,
		pendingDecision: null,
		...overrides
	};
}

const SEED = indexAccounts([
	account({ email: 'admin1@yopmail.com', name: 'Alice Vaughn', roles: ['ADMIN'] as Role[] }),
	account({ email: 'hacker2@yopmail.com', name: 'Dana Liu' }),
	account({ email: 'hacker10@yopmail.com', name: 'Eli Mora' }),
	account({
		email: 'judge1@yopmail.com',
		name: 'Cara Kim',
		roles: ['JUDGE'] as Role[],
		status: 'CONFIRMED' as UserStatus
	})
]);

describe('primaryRole', () => {
	it('files a mixed-role account under the strongest role it holds', () => {
		expect(primaryRole(['HACKER', 'ADMIN'] as Role[])).toBe('ADMIN');
		expect(primaryRole(['VOLUNTEER', 'ORGANIZER'] as Role[])).toBe('ORGANIZER');
	});

	it('falls back for an account with no roles at all', () => {
		expect(primaryRole([])).toBe('UNDECLARED');
	});
});

describe('filterAccounts', () => {
	const emails = (rows: { email: string }[]) => rows.map((r) => r.email);

	it('returns everything when nothing is set', () => {
		expect(filterAccounts(SEED)).toHaveLength(4);
		expect(filterAccounts(SEED, {})).toHaveLength(4);
	});

	it('matches the query against the name', () => {
		expect(emails(filterAccounts(SEED, { query: 'dana' }))).toEqual(['hacker2@yopmail.com']);
	});

	it('matches the query against the email', () => {
		expect(emails(filterAccounts(SEED, { query: 'admin1' }))).toEqual(['admin1@yopmail.com']);
	});

	it('matches the query against the role name', () => {
		// The reason the role goes into the haystack: typing a role filters to it
		// without anyone reaching for a chip.
		expect(emails(filterAccounts(SEED, { query: 'judge' }))).toEqual(['judge1@yopmail.com']);
	});

	it('ignores case and surrounding whitespace', () => {
		expect(filterAccounts(SEED, { query: '  ALICE  ' })).toHaveLength(1);
	});

	it('treats an empty selection as no filter rather than as matching nothing', () => {
		expect(filterAccounts(SEED, { roles: [], statuses: [] })).toHaveLength(4);
	});

	it('matches a role the account merely contains', () => {
		const both = indexAccounts([
			account({ email: 'x@yopmail.com', roles: ['HACKER', 'ADMIN'] as Role[] })
		]);
		expect(filterAccounts(both, { roles: ['ADMIN'] as Role[] })).toHaveLength(1);
	});

	it('ORs within the role group', () => {
		const rows = filterAccounts(SEED, { roles: ['ADMIN', 'JUDGE'] as Role[] });
		expect(emails(rows).sort()).toEqual(['admin1@yopmail.com', 'judge1@yopmail.com']);
	});

	it('ANDs across groups, and with the query', () => {
		// JUDGE matches the role filter but its status is CONFIRMED, so the
		// combination has to come back empty.
		expect(
			filterAccounts(SEED, {
				roles: ['JUDGE'] as Role[],
				statuses: ['APPLIED'] as UserStatus[]
			})
		).toHaveLength(0);

		expect(filterAccounts(SEED, { roles: ['HACKER'] as Role[], query: 'eli' })).toHaveLength(1);
	});
});

describe('decision filters', () => {
	// The fixture that motivates keeping the two columns apart: `split` has been
	// released as ACCEPTED while a reviewer has since marked it REJECTED, unreleased.
	const DECIDED = indexAccounts([
		account({ email: 'hacker1@yopmail.com', activeDecision: 'ACCEPTED' as DecisionStatus }),
		account({ email: 'hacker2@yopmail.com', activeDecision: 'WAITLISTED' as DecisionStatus }),
		account({
			email: 'hacker3@yopmail.com',
			pendingDecision: 'ACCEPTED' as DecisionStatus
		}),
		account({
			email: 'split@yopmail.com',
			activeDecision: 'ACCEPTED' as DecisionStatus,
			pendingDecision: 'REJECTED' as DecisionStatus
		}),
		account({ email: 'hacker5@yopmail.com' })
	]);

	const emails = (rows: { email: string }[]) => rows.map((r) => r.email).sort();

	it('filters on the released decision', () => {
		expect(
			emails(filterAccounts(DECIDED, { decisions: ['ACCEPTED'] as DecisionFilterValue[] }))
		).toEqual(['hacker1@yopmail.com', 'split@yopmail.com']);
	});

	it('filters on the held decision independently of the released one', () => {
		// Only `split` — hacker1 is also ACCEPTED, but released, not held.
		expect(
			emails(filterAccounts(DECIDED, { pendingDecisions: ['REJECTED'] as DecisionFilterValue[] }))
		).toEqual(['split@yopmail.com']);
	});

	it('matches a null column through the NONE option', () => {
		expect(emails(filterAccounts(DECIDED, { decisions: [NO_DECISION] }))).toEqual([
			'hacker3@yopmail.com',
			'hacker5@yopmail.com'
		]);
	});

	it('ANDs the two decision groups together', () => {
		expect(
			emails(
				filterAccounts(DECIDED, {
					decisions: ['ACCEPTED'] as DecisionFilterValue[],
					pendingDecisions: ['REJECTED'] as DecisionFilterValue[]
				})
			)
		).toEqual(['split@yopmail.com']);
	});

	it('treats an empty decision selection as no filter', () => {
		expect(filterAccounts(DECIDED, { decisions: [], pendingDecisions: [] })).toHaveLength(5);
	});

	it('offers only the values some row actually has, in outcome order', () => {
		expect(decisionOptions(DECIDED, 'activeDecision')).toEqual([
			'ACCEPTED',
			'WAITLISTED',
			NO_DECISION
		]);
		expect(decisionOptions(DECIDED, 'pendingDecision')).toEqual([
			'ACCEPTED',
			'REJECTED',
			NO_DECISION
		]);
	});

	it('offers nothing at all for an empty account list', () => {
		expect(decisionOptions([], 'activeDecision')).toEqual([]);
	});
});

describe('loadFilters / saveFilters', () => {
	const FILLED: StoredFilters = {
		query: 'judge',
		roles: ['JUDGE'],
		statuses: ['CONFIRMED'],
		decisions: ['ACCEPTED'],
		pendingDecisions: [NO_DECISION]
	};
	const EMPTY: StoredFilters = {
		query: '',
		roles: [],
		statuses: [],
		decisions: [],
		pendingDecisions: []
	};

	function storageOf(raw: string | null) {
		return { getItem: () => raw };
	}

	it('round-trips a full selection', () => {
		const store: Record<string, string> = {};
		saveFilters({ setItem: (k, v) => void (store[k] = v) }, FILLED);

		expect(loadFilters(storageOf(store[FILTERS_KEY]))).toEqual(FILLED);
	});

	it.each([
		['a missing key', null],
		['invalid JSON', 'garbage'],
		['a JSON primitive', '42'],
		['a stale version', '{"v":0,"query":"judge"}']
	])('falls back to the empty set for %s', (_label, raw) => {
		expect(loadFilters(storageOf(raw))).toEqual(EMPTY);
	});

	it('drops non-string entries rather than the whole record', () => {
		const raw = '{"v":1,"query":7,"roles":["JUDGE",5,null],"statuses":"CONFIRMED"}';
		expect(loadFilters(storageOf(raw))).toEqual({ ...EMPTY, roles: ['JUDGE'] });
	});

	it('keeps a value that is no longer a valid enum', () => {
		// One stale chip must not cost the other four. It matches nothing and is one
		// click of Clear away.
		expect(loadFilters(storageOf('{"v":1,"roles":["WIZARD"]}'))).toEqual({
			...EMPTY,
			roles: ['WIZARD']
		});
	});

	it('falls back rather than propagating when storage itself throws', () => {
		const hostile = {
			getItem: () => {
				throw new Error('SecurityError');
			}
		};
		expect(loadFilters(hostile)).toEqual(EMPTY);
	});

	it('swallows a failing write', () => {
		const hostile = {
			setItem: () => {
				throw new Error('QuotaExceededError');
			}
		};
		expect(() => saveFilters(hostile, FILLED)).not.toThrow();
	});
});

describe('sortAccounts', () => {
	it('orders by role rank, then numerically within a role', () => {
		// hacker10 before hacker2 is exactly what plain lexicographic sorting gets
		// wrong, and what makes a 120-row list unreadable.
		expect(sortAccounts(SEED).map((a) => a.email)).toEqual([
			'admin1@yopmail.com',
			'judge1@yopmail.com',
			'hacker2@yopmail.com',
			'hacker10@yopmail.com'
		]);
	});

	it('does not mutate its input', () => {
		const before = SEED.map((a) => a.email);
		sortAccounts(SEED);
		expect(SEED.map((a) => a.email)).toEqual(before);
	});
});

describe('loadPosition / savePosition', () => {
	function storageOf(raw: string | null) {
		return { getItem: () => raw };
	}

	it('round-trips a valid position', () => {
		const store: Record<string, string> = {};
		savePosition({ setItem: (k, v) => void (store[k] = v) }, { x: 120, y: 340 });

		expect(loadPosition(storageOf(store[POSITION_KEY]))).toEqual({ x: 120, y: 340 });
	});

	it.each([
		['a missing key', null],
		['invalid JSON', 'garbage'],
		['a JSON primitive', '42'],
		['a stale version', '{"v":0,"x":1,"y":2}'],
		['string coordinates', '{"v":1,"x":"1","y":"2"}'],
		['a missing coordinate', '{"v":1,"x":10}'],
		['a non-finite coordinate', '{"v":1,"x":null,"y":2}']
	])('returns null for %s', (_label, raw) => {
		expect(loadPosition(storageOf(raw))).toBeNull();
	});

	it('returns null rather than propagating when storage itself throws', () => {
		// Safari private mode. This widget mounts on every page, so a storage
		// failure must never be able to take the page down with it.
		const hostile = {
			getItem: () => {
				throw new Error('SecurityError');
			}
		};
		expect(loadPosition(hostile)).toBeNull();
	});

	it('swallows a failing write', () => {
		const hostile = {
			setItem: () => {
				throw new Error('QuotaExceededError');
			}
		};
		expect(() => savePosition(hostile, { x: 1, y: 1 })).not.toThrow();
	});
});

describe('clampPosition', () => {
	const VIEWPORT = { w: 1440, h: 900 };
	const BUTTON = { w: 36, h: 36 };
	const MARGIN = 12;
	const clamp = (pos: Position) => clampPosition(pos, VIEWPORT, BUTTON, MARGIN);

	it('leaves a position that is already on screen alone', () => {
		expect(clamp({ x: 400, y: 400 })).toEqual({ x: 400, y: 400 });
	});

	it('pulls a position past the far edges back by exactly the margin', () => {
		expect(clamp({ x: 5000, y: 5000 })).toEqual({ x: 1392, y: 852 });
	});

	it('clamps negatives up to the margin', () => {
		expect(clamp({ x: -300, y: -1 })).toEqual({ x: MARGIN, y: MARGIN });
	});

	it('recovers a position saved on a larger monitor', () => {
		// The case this function exists for: dragged to the corner of a 4K display,
		// reopened on a laptop. It has to land somewhere clickable.
		const restored = clamp({ x: 3800, y: 2000 });
		expect(restored.x).toBeLessThanOrEqual(VIEWPORT.w - BUTTON.w);
		expect(restored.y).toBeLessThanOrEqual(VIEWPORT.h - BUTTON.h);
		expect(restored.x).toBeGreaterThanOrEqual(MARGIN);
		expect(restored.y).toBeGreaterThanOrEqual(MARGIN);
	});

	it('stays positive in a viewport narrower than the button', () => {
		// Without Math.max on the upper bound the clamp inverts here and pins the
		// button off-screen — the one way this could cause what it prevents.
		expect(clampPosition({ x: 100, y: 100 }, { w: 20, h: 20 }, BUTTON, MARGIN)).toEqual({
			x: MARGIN,
			y: MARGIN
		});
	});
});
