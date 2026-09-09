import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * `$env/dynamic/private` is a virtual module, so it's replaced with a plain
 * object the tests mutate. `deployEnv()` reads it on every call rather than
 * caching, which is what makes per-test environments possible here at all.
 */
const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));

const resendSend = vi.fn();
vi.mock('resend', () => ({
	Resend: class {
		emails = { send: resendSend };
	}
}));

const { sendEmail, sendTemplatedEmail } = await import('./email');

beforeEach(() => {
	for (const key of Object.keys(env)) delete env[key];
	resendSend.mockReset().mockResolvedValue({ data: { id: 'sent' }, error: null });
	vi.stubEnv('NODE_ENV', 'production');
});

afterEach(() => vi.unstubAllEnvs());

const message = { to: 'hacker@example.com', subject: 'Hello', body: '# Hi there' };

/** The transport production runs. */
function configureResend() {
	env.RESEND_API_KEY = 'key';
}

describe('development', () => {
	it('sends nothing at all', async () => {
		vi.stubEnv('NODE_ENV', 'development');
		configureResend();
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});

		await sendEmail(message);

		expect(resendSend).not.toHaveBeenCalled();
		expect(log).toHaveBeenCalled();
		log.mockRestore();
	});
});

describe('preview', () => {
	let log: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		env.VERCEL_ENV = 'preview';
		log = vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterEach(() => log.mockRestore());

	it('sends nothing, even with a key configured', async () => {
		// The point of the change: a preview deploy runs a production build against
		// the production database, so its ability to send is the risk — not its
		// configuration. A key present must not re-enable delivery.
		configureResend();

		await expect(sendEmail(message)).resolves.toBeUndefined();

		expect(resendSend).not.toHaveBeenCalled();
	});

	it('sends nothing to a yopmail address either', async () => {
		// Preview used to deliver to @yopmail.com. It no longer does — that fence was
		// one predicate away from mailing real applicants.
		configureResend();

		await sendEmail({ ...message, to: 'tester@yopmail.com' });

		expect(resendSend).not.toHaveBeenCalled();
	});

	it('resolves rather than throwing when no key is set', async () => {
		delete env.RESEND_API_KEY;

		await expect(sendEmail(message)).resolves.toBeUndefined();

		expect(resendSend).not.toHaveBeenCalled();
	});
});

describe('production', () => {
	it('renders the markdown body to HTML and omits the warning', async () => {
		configureResend();

		await sendEmail(message);

		const sent = resendSend.mock.calls[0][0];
		expect(sent.html).toContain('<h1>Hi there</h1>');
		expect(sent.html).not.toContain('test environment');
		expect(sent.from).toBe('hello@freetailhackers.com');
	});

	it('honours EMAIL_FROM when set', async () => {
		configureResend();
		env.EMAIL_FROM = 'rodeo@freetailhackers.com';

		await sendEmail(message);

		expect(resendSend.mock.calls[0][0].from).toBe('rodeo@freetailhackers.com');
	});

	it('throws when Resend reports a rejection instead of throwing one', async () => {
		configureResend();
		resendSend.mockResolvedValue({ data: null, error: { message: 'domain not verified' } });

		// The SDK returns delivery failures in the response body. An unchecked call
		// counts this as a success, and the bulk callers write that straight into the
		// audit trail — which is the whole reason a failure has to be distinguishable.
		await expect(sendEmail(message)).rejects.toThrow('domain not verified');
	});

	it('propagates a thrown transport failure too', async () => {
		configureResend();
		resendSend.mockRejectedValue(new Error('fetch failed'));

		await expect(sendEmail(message)).rejects.toThrow('fetch failed');
	});

	it('ignores leftover SMTP variables', async () => {
		// Stale Amazon SES credentials are still sitting in Vercel Production. They
		// authenticate against nothing, and nothing may fall back to them.
		env.EMAIL_HOST = 'email-smtp.us-east-1.amazonaws.com';
		env.EMAIL_USER = 'AKIAEXAMPLE';
		env.EMAIL_PASS = 'stale';

		await expect(sendEmail(message)).rejects.toThrow('No email transport configured');
	});

	it('throws when no transport is configured', async () => {
		await expect(sendEmail(message)).rejects.toThrow('No email transport configured');
	});

	it('carries a content_id only for inline attachments', async () => {
		configureResend();

		await sendEmail({
			...message,
			attachments: [
				{
					filename: 'qr.png',
					content: Buffer.from('png'),
					contentType: 'image/png',
					contentId: 'qr',
					inline: true
				},
				// A plain attachment: a cid here would hide it from clients that treat
				// cid parts as inline-only.
				{ filename: 'schedule.pdf', content: Buffer.from('pdf'), contentType: 'application/pdf' }
			]
		});

		const [inline, plain] = resendSend.mock.calls[0][0].attachments;
		expect(inline.content_id).toBe('qr');
		expect(plain.filename).toBe('schedule.pdf');
		expect('content_id' in plain).toBe(false);
	});
});

describe('sendTemplatedEmail', () => {
	it('substitutes variables into both the subject and the body', async () => {
		configureResend();

		await sendTemplatedEmail(
			'sarah@example.com',
			{ subject: 'Hi {{name}}', body: 'See you on {{hackathon_start}}.' },
			{ name: 'Sarah Chen', hackathon_start: '4/15/2026' }
		);

		const sent = resendSend.mock.calls[0][0];
		expect(sent.subject).toBe('Hi Sarah Chen');
		expect(sent.html).toContain('See you on 4/15/2026.');
	});
});
