import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserStatus } from '$lib/generated/prisma/enums';
import { LONG_LIVED_CERT_PEM } from './test-fixtures/certificates';

const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));
vi.mock('$app/environment', () => ({ dev: true }));

const { buildCheckInPassBlock, buildEmailPersonalization } = await import('./email-block');

const RSVP_DEADLINE = new Date('2026-04-01');
const AFTER = new Date('2026-04-02');
const BEFORE = new Date('2026-03-15');

const settings = { RSVPDeadline: RSVP_DEADLINE, hackathonStartDate: new Date('2026-04-15') };
const hacker = {
	uid: 'clx1a2b3c4d5e6f7g8h9i0jk',
	name: 'Ada Lovelace',
	status: UserStatus.CONFIRMED
};

function configureProviders() {
	env.APPLE_PASS_SIGNER_CERT = LONG_LIVED_CERT_PEM;
	env.APPLE_PASS_SIGNER_KEY =
		'-----BEGIN PRIVATE KEY-----\nMIIBVgIBADANBg==\n-----END PRIVATE KEY-----';
	env.APPLE_PASS_TYPE_IDENTIFIER = 'pass.com.freetailhackers.rodeo';
	env.APPLE_PASS_TEAM_IDENTIFIER = 'L9U4TT58WC';
	env.GOOGLE_WALLET_SERVICE_ACCOUNT = Buffer.from(
		JSON.stringify({
			client_email: 'wallet@rodeo.iam.gserviceaccount.com',
			private_key: '-----BEGIN PRIVATE KEY-----\nMIIBVgIBADANBg==\n-----END PRIVATE KEY-----'
		})
	).toString('base64');
	env.GOOGLE_WALLET_ISSUER_ID = '3388000000022880544';
	env.GOOGLE_WALLET_CLASS_SUFFIX = 'rodeo-2026';
}

beforeEach(() => {
	for (const key of Object.keys(env)) delete env[key];
	env.APP_ORIGIN = 'https://rodeo.freetailhackers.com';
});

describe('who gets a block', () => {
	it.each([UserStatus.CREATED, UserStatus.APPLIED, UserStatus.DECLINED])(
		'produces nothing for a %s account',
		async (status) => {
			// The rest of the email still sends — the variable just expands to nothing,
			// rather than leaving a gap where a QR should be.
			configureProviders();
			const block = await buildCheckInPassBlock({ ...hacker, status }, settings, AFTER);
			expect(block).toEqual({ html: '', attachments: [] });
		}
	);

	it.each([UserStatus.CONFIRMED, UserStatus.CHECKED_IN])(
		'produces a block for a %s account',
		async (status) => {
			const block = await buildCheckInPassBlock({ ...hacker, status }, settings, AFTER);
			expect(block.html).toContain('RC-I0JK');
			expect(block.attachments).toHaveLength(1);
		}
	);
});

describe('the QR image', () => {
	it('is a real PNG carried inline by content id', async () => {
		const { attachments, html } = await buildCheckInPassBlock(hacker, settings, AFTER);
		const [image] = attachments;

		expect(image.content.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
		expect(image.contentType).toBe('image/png');
		expect(image.inline).toBe(true);
		// The body must reference exactly the id the attachment declares, or the
		// client renders a broken image.
		expect(html).toContain(`src="cid:${image.contentId}"`);
	});

	it('uses a per-recipient content id', async () => {
		// A bulk send builds one message per person; a shared id risks a client
		// pairing the wrong image with the wrong body.
		const a = await buildCheckInPassBlock(hacker, settings, AFTER);
		const b = await buildCheckInPassBlock({ ...hacker, uid: 'other-uid-9999' }, settings, AFTER);
		expect(a.attachments[0].contentId).not.toBe(b.attachments[0].contentId);
	});

	it('encodes the uid, matching the on-screen QR and both wallet passes', async () => {
		// Decoding a PNG needs a reader we don't have, so this asserts the contract
		// at its source: `QRCode.toBuffer` is called with the raw uid.
		const qrcode = await import('qrcode');
		const spy = vi.spyOn(qrcode.default, 'toBuffer');
		await buildCheckInPassBlock(hacker, settings, AFTER);
		expect(spy).toHaveBeenCalledWith(hacker.uid, expect.anything());
		spy.mockRestore();
	});
});

describe('the wallet buttons', () => {
	it('appear once the RSVP deadline has passed', async () => {
		configureProviders();
		const { html } = await buildCheckInPassBlock(hacker, settings, AFTER);

		expect(html).toContain('https://rodeo.freetailhackers.com/hacker/account/wallet/apple');
		expect(html).toContain('https://rodeo.freetailhackers.com/hacker/account/wallet/google');
	});

	it('are withheld while the RSVP window is still open, but the QR is not', async () => {
		// Mirrors the account page: the QR shows at CONFIRMED, wallet passes wait for
		// the deadline. A hacker should never be emailed something the site won't show.
		configureProviders();
		const { html, attachments } = await buildCheckInPassBlock(hacker, settings, BEFORE);

		expect(html).not.toContain('/wallet/');
		expect(html).toContain('RC-I0JK');
		expect(attachments).toHaveLength(1);
	});

	it('latch to the event start when no RSVP deadline is set', async () => {
		configureProviders();
		const noDeadline = { RSVPDeadline: null, hackathonStartDate: new Date('2026-04-15') };

		const before = await buildCheckInPassBlock(hacker, noDeadline, AFTER);
		expect(before.html).not.toContain('/wallet/');

		const after = await buildCheckInPassBlock(hacker, noDeadline, new Date('2026-04-16'));
		expect(after.html).toContain('/wallet/apple');
	});

	it('are withheld when no provider is configured', async () => {
		const { html } = await buildCheckInPassBlock(hacker, settings, AFTER);
		expect(html).not.toContain('/wallet/');
	});

	it('drops only the provider that is unavailable', async () => {
		configureProviders();
		delete env.GOOGLE_WALLET_SERVICE_ACCOUNT;
		const { html } = await buildCheckInPassBlock(hacker, settings, AFTER);

		expect(html).toContain('/wallet/apple');
		expect(html).not.toContain('/wallet/google');
	});

	it('uses absolute URLs — a relative href is meaningless in an inbox', async () => {
		configureProviders();
		const { html } = await buildCheckInPassBlock(hacker, settings, AFTER);
		expect(html).not.toMatch(/href="\//);
	});
});

describe('escaping', () => {
	it('escapes the name it embeds', async () => {
		// The block is substituted unescaped, so anything it embeds must be escaped
		// here. `name` is applicant-controlled via a linked question.
		const { html } = await buildCheckInPassBlock(
			{ ...hacker, name: '<script>alert(1)</script>' },
			settings,
			AFTER
		);
		expect(html).not.toContain('<script>');
		expect(html).toContain('&lt;script&gt;');
	});
});

describe('buildEmailPersonalization', () => {
	it('returns the block and its attachment together', async () => {
		// One call so the two cannot drift: vars without the attachment would mail a
		// body referencing a cid that isn't there.
		const { vars, attachments } = await buildEmailPersonalization(hacker, settings, AFTER);

		expect(vars.name).toBe('Ada Lovelace');
		expect(vars.hacker_qr_code).toContain('cid:');
		expect(attachments).toHaveLength(1);
		expect(vars.hacker_qr_code).toContain(attachments[0].contentId);
	});

	it('gives an unconfirmed recipient an empty block and no attachment', async () => {
		const { vars, attachments } = await buildEmailPersonalization(
			{ ...hacker, status: UserStatus.APPLIED },
			settings,
			AFTER
		);

		expect(vars.hacker_qr_code).toBe('');
		expect(attachments).toEqual([]);
		// The other variables still work — the email itself is unaffected.
		expect(vars.name).toBe('Ada Lovelace');
	});
});
