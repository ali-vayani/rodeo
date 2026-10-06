import { describe, it, expect, beforeEach } from 'vitest';
import { mockDeep, mockReset } from 'vitest-mock-extended';
import type { PrismaClient } from '$lib/generated/prisma/client';
import { UserStatus } from '$lib/generated/prisma/enums';
import { assertWalletPassEligible, walletIneligibility } from './guard';

const db = mockDeep<PrismaClient>();

const RSVP_DEADLINE = new Date('2024-04-01');
const EVENT_START = new Date('2024-04-05');
const AFTER = new Date('2024-04-02');
const BEFORE = new Date('2024-03-15');

const confirmed = { status: UserStatus.CONFIRMED };

beforeEach(() => {
	mockReset(db);
	db.settings.findFirst.mockResolvedValue({
		RSVPDeadline: RSVP_DEADLINE,
		hackathonStartDate: EVENT_START
	} as never);
});

describe('walletIneligibility', () => {
	it('admits a confirmed attendee past the deadline', async () => {
		expect(await walletIneligibility(db, confirmed, AFTER)).toBeNull();
	});

	it('selects only the unlock columns', async () => {
		// The guard has no business reading email templates or the timezone.
		await walletIneligibility(db, confirmed, AFTER);
		expect(db.settings.findFirst).toHaveBeenCalledWith({
			select: { RSVPDeadline: true, hackathonStartDate: true }
		});
	});

	it('treats a missing Settings row as not-yet', async () => {
		// The fail-open trap: `settings.get()` would substitute DEFAULT_SETTINGS,
		// whose hackathonStartDate is `new Date()` frozen at module load and therefore
		// always in the past. Reading the row directly keeps `null` meaning `null`.
		db.settings.findFirst.mockResolvedValue(null as never);
		expect(await walletIneligibility(db, confirmed, AFTER)).toBe('RSVP_STILL_OPEN');
	});

	it('latches to the event start when the deadline is null', async () => {
		db.settings.findFirst.mockResolvedValue({
			RSVPDeadline: null,
			hackathonStartDate: EVENT_START
		} as never);
		expect(await walletIneligibility(db, confirmed, AFTER)).toBe('RSVP_STILL_OPEN');
		expect(await walletIneligibility(db, confirmed, new Date('2024-04-06'))).toBeNull();
	});
});

describe('assertWalletPassEligible', () => {
	it('passes silently for an eligible attendee', async () => {
		await expect(assertWalletPassEligible(db, confirmed, AFTER)).resolves.toBeUndefined();
	});

	it('throws a 403 while the RSVP window is open', async () => {
		// The endpoints are the authority, not the UI — a hand-typed URL gets this.
		await expect(assertWalletPassEligible(db, confirmed, BEFORE)).rejects.toMatchObject({
			status: 403,
			body: { message: expect.stringContaining('attendee list') }
		});
	});

	it('throws a 403 for an account that never confirmed', async () => {
		await expect(
			assertWalletPassEligible(db, { status: UserStatus.APPLIED }, AFTER)
		).rejects.toMatchObject({
			status: 403,
			body: { message: expect.stringContaining('confirmed attendee') }
		});
	});
});
