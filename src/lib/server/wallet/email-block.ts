/**
 * The check-in block that `{{hacker_qr_code}}` expands to: the hacker's QR code, the
 * printed `RC-` code, and, when they are eligible, the two wallet buttons. One insert
 * produces all of it, because a QR without the buttons is what this feature exists to
 * stop people needing.
 *
 * The QR is an inline `cid:` attachment. `data:` URIs are stripped by Gmail and
 * Outlook, and a hosted `/qr/<uid>.png` would make the check-in credential fetchable by
 * anyone holding the URL, with Gmail's proxy caching a copy. Resend carries it as
 * `content_id`.
 *
 * The wallet buttons are ordinary authenticated links that re-check eligibility, so a
 * signed-out click bounces through `/login?redirectTo=...`. That bounce is the point: a
 * forwarded copy carries no credential that could mint somebody else's pass.
 *
 * Eligibility mirrors the account page exactly. Not confirmed means no block at all and
 * the rest of the email sends normally; confirmed before the wallet unlock date means
 * the QR without wallet buttons.
 */

import QRCode from 'qrcode';
import { UserStatus } from '$lib/generated/prisma/enums';
import { isWalletUnlocked } from '$lib/wallet/eligibility';
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
	/** Substituted into the body for `{{hacker_qr_code}}`. Empty when there is nothing to show. */
	html: string;
	/** The QR image, or nothing when no block was produced. */
	attachments: EmailAttachment[];
};

/** What a non-attending recipient gets: the variable expands to nothing and the email still sends. */
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
 * A stable but per-recipient Content-ID. Per-recipient because a bulk send builds one
 * message per person and a shared id risks a client pairing the wrong image with the
 * wrong body. The `@rodeo` suffix keeps it a well-formed addr-spec.
 */
function contentId(uid: string): string {
	return `checkin-${uid}@rodeo`;
}

export async function buildCheckInPassBlock(
	user: CheckInPassSubject,
	settings: { RSVPDeadline: Date | null; hackathonStartDate: Date } | null | undefined,
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

	// Wallet passes need the unlock date behind us *and* a configured provider.
	const walletUnlocked = isWalletUnlocked(settings, now);
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

	// Tables and inline styles, not flexbox and classes: Outlook renders on Word's engine,
	// which supports neither. `role="presentation"` keeps the scaffolding unannounced.
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
 * Everything one recipient's message needs: their variable values and any attachment
 * those values reference. A single call, so a caller cannot take the vars without the
 * attachment and mail a broken image.
 *
 * Takes the raw Settings row and splits it deliberately: template dates go through
 * `emailSettings`, whose defaults keep an unconfigured install sending, while wallet
 * gating reads the row as-is, since `DEFAULT_SETTINGS.hackathonStartDate` is process
 * boot time and would put wallet buttons in every confirmed hacker's inbox.
 */
export async function buildEmailPersonalization(
	user: CheckInPassSubject,
	settings: { hackathonStartDate: Date; RSVPDeadline: Date | null } | null,
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
