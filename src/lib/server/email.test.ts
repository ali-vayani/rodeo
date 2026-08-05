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

const sendMail = vi.fn();
vi.mock('nodemailer', () => ({
	default: { createTransport: () => ({ sendMail }) }
}));

const { sendEmail, sendTemplatedEmail } = await import('./email');

beforeEach(() => {
	for (const key of Object.keys(env)) delete env[key];
	resendSend.mockReset().mockResolvedValue({ data: { id: 'sent' }, error: null });
	sendMail.mockReset().mockResolvedValue({});
	vi.stubEnv('NODE_ENV', 'production');
});

afterEach(() => vi.unstubAllEnvs());

const message = { to: 'hacker@example.com', subject: 'Hello', body: '# Hi there' };

describe('development', () => {
	it('sends nothing at all', async () => {
		vi.stubEnv('NODE_ENV', 'development');
		env.RESEND_API_KEY = 'key';
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});

		await sendEmail(message);

		expect(resendSend).not.toHaveBeenCalled();
		expect(sendMail).not.toHaveBeenCalled();
		expect(log).toHaveBeenCalled();
		log.mockRestore();
	});
});

describe('preview', () => {
	beforeEach(() => {
		env.VERCEL_ENV = 'preview';
		env.RESEND_API_KEY = 'key';
	});

	it('refuses to mail a real address', async () => {
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});

		await sendEmail(message);

		// The one mistake that can't be taken back: a branch deploy mailing real
		// applicants off the production database.
		expect(resendSend).not.toHaveBeenCalled();
		log.mockRestore();
	});

	it('sends to yopmail addresses, with a warning banner', async () => {
		await sendEmail({ ...message, to: 'tester@yopmail.com' });

		expect(resendSend).toHaveBeenCalledTimes(1);
		expect(resendSend.mock.calls[0][0].html).toContain('test environment');
	});

	it('matches the allowed domain case-insensitively', async () => {
		await sendEmail({ ...message, to: 'Tester@YOPmail.com' });

		expect(resendSend).toHaveBeenCalledTimes(1);
	});
});

describe('production', () => {
	it('renders the markdown body to HTML and omits the warning', async () => {
		env.RESEND_API_KEY = 'key';

		await sendEmail(message);

		const sent = resendSend.mock.calls[0][0];
		expect(sent.html).toContain('<h1>Hi there</h1>');
		expect(sent.html).not.toContain('test environment');
		expect(sent.from).toBe('hello@freetailhackers.com');
	});

	it('honours EMAIL_FROM when set', async () => {
		env.RESEND_API_KEY = 'key';
		env.EMAIL_FROM = 'rodeo@freetailhackers.com';

		await sendEmail(message);

		expect(resendSend.mock.calls[0][0].from).toBe('rodeo@freetailhackers.com');
	});

	it('throws when Resend reports a rejection instead of throwing one', async () => {
		env.RESEND_API_KEY = 'key';
		resendSend.mockResolvedValue({ data: null, error: { message: 'domain not verified' } });

		// The SDK returns delivery failures in the response body. An unchecked call
		// would count this as a success and the audit trail would say so too.
		await expect(sendEmail(message)).rejects.toThrow('domain not verified');
	});

	it('falls back to SMTP when no Resend key is configured', async () => {
		env.EMAIL_HOST = 'smtp.example.com';
		env.EMAIL_USER = 'user';
		env.EMAIL_PASS = 'pass';

		await sendEmail(message);

		expect(sendMail).toHaveBeenCalledTimes(1);
		expect(resendSend).not.toHaveBeenCalled();
	});

	it('prefers Resend when both transports are configured', async () => {
		env.RESEND_API_KEY = 'key';
		env.EMAIL_HOST = 'smtp.example.com';
		env.EMAIL_USER = 'user';
		env.EMAIL_PASS = 'pass';

		await sendEmail(message);

		expect(resendSend).toHaveBeenCalledTimes(1);
		expect(sendMail).not.toHaveBeenCalled();
	});

	it('throws when no transport is configured at all', async () => {
		await expect(sendEmail(message)).rejects.toThrow('No email transport configured');
	});
});

describe('sendTemplatedEmail', () => {
	it('substitutes variables into both the subject and the body', async () => {
		env.RESEND_API_KEY = 'key';

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
