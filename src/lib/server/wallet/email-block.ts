/**
 * The check-in block that `{{check_in_pass}}` expands to.
 *
 * One insert in the email editor produces the hacker's QR code, the printed
 * `RC-` code beneath it, and — when they are eligible — an Add to Apple Wallet
 * and an Add to Google Wallet button. Organizers place one variable; the three
 * pieces travel together, because a QR code without the wallet buttons is the
 * thing this feature exists to stop people needing.
 *
 * ## The QR is an inline attachment, not a hosted image
 *
 * Email clients run no JavaScript, so the code has to arrive as an `<img>`. The
 * three ways to do that are not equivalent:
 *
 *   - `data:` URIs are stripped by Gmail and Outlook. Not an option.
 *   - A hosted `/qr/<uid>.png` endpoint works everywhere, but it makes the
 *     check-in credential fetchable by anyone holding the URL, and Gmail's image
 *     proxy would keep a cached copy on googleusercontent.com.
 *   - A `cid:` attachment travels inside the message. Nothing is hosted, no
 *     endpoint exists to be found, and no proxy caches it.
 *
 * The third, therefore — Resend carries it as `content_id`.
 *
 * ## The wallet buttons are ordinary authenticated links
 *
 * They point at `/hacker/account/wallet/{apple,google}`, which require a session
 * and re-check eligibility. Someone who clicks from a signed-out browser lands on
 * `/login?redirectTo=…` and arrives at their pass afterwards. That bounce is the
 * point: it means the email carries no credential that would let a forwarded copy
 * mint somebody else's pass.
 *
 * ## Eligibility mirrors the account page exactly
 *
 * Not confirmed → no block at all, and the rest of the email sends normally.
 * Confirmed but the RSVP deadline hasn't passed → the QR, no wallet buttons —
 * matching `showEventContent` and the wallet gate respectively. A hacker should
 * never receive an email showing them something the site would not.
 */

import QRCode from 'qrcode';
import { UserStatus } from '$lib/generated/prisma/enums';
import { isRsvpClosed } from '$lib/application/window';
import { appOrigin } from '$lib/server/env';
import { emailSettings } from '$lib/server/settings';
import { buildTemplateVars } from '$lib/email/variables';
import { appleWalletConfigured, googleWalletConfigured } from './config';
import type { EmailAttachment } from '$lib/server/email';

export type CheckInPassSubject = {
	uid: string;
	name: string;
	status: UserStatus;
};

export type CheckInPassBlock = {
	/** Substituted into the body for `{{check_in_pass}}`. Empty when there is nothing to show. */
	html: string;
	/** The QR image, or nothing when no block was produced. */
	attachments: EmailAttachment[];
};

const EMPTY: CheckInPassBlock = { html: '', attachments: [] };

/** Matches `QRCard.svelte` so the printed code is the same in both places. */
function displayCode(uid: string): string {
	return 'RC-' + uid.slice(-4).toUpperCase();
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * A stable but per-recipient Content-ID.
 *
 * Per-recipient because a bulk send builds one message per person and a shared id
 * would risk a client pairing the wrong image with the wrong body. The `@rodeo`
 * suffix keeps it a well-formed addr-spec, which older clients are fussy about.
 */
function contentId(uid: string): string {
	return `checkin-${uid}@rodeo`;
}

export async function buildCheckInPassBlock(
	user: CheckInPassSubject,
	settings: { RSVPDeadline: Date } | null | undefined,
	now: Date = new Date()
): Promise<CheckInPassBlock> {
	const attending = user.status === UserStatus.CONFIRMED || user.status === UserStatus.CHECKED_IN;
	if (!attending) return EMPTY;

	// Same barcode payload as the on-screen QR and both wallet passes: the full
	// uid, which `resolveUserByCode` in the scan router matches on.
	const png = await QRCode.toBuffer(user.uid, {
		width: 220,
		margin: 1,
		color: { dark: '#191919', light: '#ffffff' }
	});

	const cid = contentId(user.uid);
	const code = displayCode(user.uid);
	const origin = appOrigin();

	// Wallet passes need the RSVP deadline behind us *and* a configured provider.
	const walletUnlocked = isRsvpClosed(settings, now);
	const apple = walletUnlocked && appleWalletConfigured(now);
	const google = walletUnlocked && googleWalletConfigured();

	const buttons: string[] = [];
	if (apple) {
		buttons.push(
			walletButton(`${origin}/hacker/account/wallet/apple`, 'Add to Apple Wallet', true)
		);
	}
	if (google) {
		buttons.push(
			walletButton(`${origin}/hacker/account/wallet/google`, 'Add to Google Wallet', false)
		);
	}

	// Tables and inline styles, not flexbox and classes: Outlook renders on Word's
	// engine, which supports neither. `role="presentation"` keeps screen readers
	// from announcing the layout scaffolding as a data table.
	const html = `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px auto;border-collapse:collapse;">
	<tr>
		<td align="center" style="padding:24px;border:1px solid #e0e0e0;border-radius:8px;background:#ffffff;font-family:Helvetica,Arial,sans-serif;">
			<img src="cid:${cid}" width="220" height="220" alt="Check-in QR code for ${escapeHtml(user.name)}" style="display:block;border:0;outline:none;text-decoration:none;width:220px;height:220px;" />
			<div style="margin-top:12px;font-family:'Courier New',Courier,monospace;font-size:15px;font-weight:bold;color:#191919;letter-spacing:1px;">${code}</div>
			<div style="margin-top:4px;font-size:12px;color:#767676;">Show this at check-in</div>
			${buttons.length ? `<div style="margin-top:16px;">${buttons.join('')}</div>` : ''}
		</td>
	</tr>
</table>
`.trim();

	return {
		html,
		attachments: [
			{
				filename: `${code}.png`,
				content: png,
				contentType: 'image/png',
				contentId: cid,
				inline: true
			}
		]
	};
}

/**
 * Everything one recipient's message needs: their variable values and any
 * attachment those values reference.
 *
 * A single call so the two cannot drift — `{{check_in_pass}}` expands to markup
 * containing `cid:…`, and a caller that took the vars without the attachment
 * would mail a broken image. Every send path goes through here.
 *
 * Takes the raw Settings row, nullable, and splits it deliberately: the template
 * dates go through `emailSettings`, whose defaults keep an unconfigured install
 * sending, while wallet gating reads the row as-is — `DEFAULT_SETTINGS.RSVPDeadline`
 * is process boot time, which reads as "deadline passed" and would put wallet
 * buttons in every confirmed hacker's inbox. Same rule `$lib/server/settings`
 * documents: email copy has a safe default; a deadline does not.
 */
export async function buildEmailPersonalization(
	user: CheckInPassSubject,
	settings: { hackathonStartDate: Date; RSVPDeadline: Date } | null,
	now: Date = new Date()
): Promise<{ vars: Record<string, string>; attachments: EmailAttachment[] }> {
	const block = await buildCheckInPassBlock(user, settings, now);
	return {
		vars: buildTemplateVars(user, emailSettings(settings), block.html),
		attachments: block.attachments
	};
}

/** One wallet button. `filled` distinguishes the primary (Apple) from the secondary. */
function walletButton(href: string, label: string, filled: boolean): string {
	const style = filled
		? 'background:#191919;color:#ffffff;border:1px solid #191919;'
		: 'background:#ffffff;color:#191919;border:1px solid #e0e0e0;';
	return `<a href="${href}" style="display:block;margin:6px 0;padding:11px 18px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:500;font-family:Helvetica,Arial,sans-serif;${style}">${label}</a>`;
}
