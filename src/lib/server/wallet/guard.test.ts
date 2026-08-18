import { describe, it, expect, beforeEach } from 'vitest';
import { mockDeep, mockReset } from 'vitest-mock-extended';
import type { PrismaClient } from '$lib/generated/prisma/client';
import { UserStatus } from '$lib/generated/prisma/enums';
import { assertWalletPassEligible, walletIneligibility } from './guard';

const db = mockDeep<PrismaClient>();

const RSVP_DEADLINE = new Date('2024-04-01');
const AFTER = new Date('2024-04-02');
const BEFORE = new Date('2024-03-15');

const confirmed = { status: UserStatus.CONFIRMED };

beforeEach(() => {
	mockReset(db);
	db.settings.findFirst.mockResolvedValue({ RSVPDeadline: RSVP_DEADLINE } as never);
});

describe('walletIneligibility', () => {
	it('admits a confirmed attendee past the deadline', async () => {
		expect(await walletIneligibility(db, confirmed, AFTER)).toBeNull();
	});

	it('selects only the deadline column', async () => {
		// The guard has no business reading email templates or the timezone.
		await walletIneligibility(db, confirmed, AFTER);
		expect(db.settings.findFirst).toHaveBeenCalledWith({ select: { RSVPDeadline: true } });
	});

	it('treats a missing Settings row as not-yet', async () => {
		// The fail-open trap: `settings.get()` would substitute DEFAULT_SETTINGS,
		// whose RSVPDeadline is `new Date()` frozen at module load and therefore
		// always in the past. Reading the row directly keeps `null` meaning `null`.
		db.settings.findFirst.mockResolvedValue(null as never);
		expect(await walletIneligibility(db, confirmed, AFTER)).toBe('RSVP_STILL_OPEN');
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
			body: { message: expect.stringContaining('RSVP deadline') }
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
