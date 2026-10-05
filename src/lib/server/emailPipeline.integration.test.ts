import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type User } from '$lib/generated/prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EmailAttachmentRef } from '$lib/email/attachments';
import { attachmentPreviewUrl } from '$lib/email/attachments';
import { emailRouter } from './trpc/routers/email';
import { settingsRouter } from './trpc/routers/settings';
import { applicationRouter } from './trpc/routers/application';
import { admissionsRouter } from './trpc/routers/admissions';
import { TEMPLATE_KEYS } from '$lib/email/templates';
import { storedAttachmentRefs } from './emailAttachments';
import { POST, GET, DELETE } from '../../routes/admin/custom-email/attachments/+server';
import * as local from './storage-local';

vi.mock('$env/dynamic/private', () => ({
	env: { VERCEL_ENV: 'production', RESEND_API_KEY: 're_local_test_only' }
}));

// Exercise real file IO while keeping production's Resend serialization enabled.
vi.mock('$lib/server/storage', async () => {
	const local = await import('./storage-local');
	return {
		...local,
		storageUnavailableReason: () => null,
		storageFailureReason: (error: unknown) => String(error),
		withStorageDetail: (message: string) => message
	};
});

const databaseUrl = process.env.EMAIL_PIPELINE_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('email pipeline with PostgreSQL and file storage', () => {
	const schema = `email_pipeline_${randomUUID().replaceAll('-', '')}`;
	let adminConnection: Client;
	let prisma: PrismaClient;
	let admin: User;
	let recipient: User;
	let caller: ReturnType<typeof emailRouter.createCaller>;
	const uploaded: string[] = [];
	const pdf = Buffer.from('%PDF-1.4\nEmail pipeline test\n%%EOF');
	const fetchMock = vi.fn<typeof fetch>();

	beforeAll(async () => {
		const url = new URL(databaseUrl!);
		if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
			throw new Error('EMAIL_PIPELINE_TEST_DATABASE_URL must point to local PostgreSQL.');
		}
		adminConnection = new Client({ connectionString: databaseUrl });
		await adminConnection.connect();
		await adminConnection.query(`CREATE SCHEMA "${schema}"`);
		execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
			env: {
				...process.env,
				DATABASE_URL: databaseUrl,
				DIRECT_URL: databaseUrl,
				DATABASE_SCHEMA: schema
			},
			stdio: 'pipe'
		});
		prisma = new PrismaClient({
			adapter: new PrismaPg({ connectionString: databaseUrl }, { schema })
		});
		admin = await prisma.user.create({
			data: { name: 'Admin', email: 'admin@example.test', role: 'ADMIN' }
		});
		recipient = await prisma.user.create({
			data: {
				name: 'Attendee',
				email: 'attendee@example.test',
				role: 'HACKER',
				status: 'CONFIRMED'
			}
		});
		caller = emailRouter.createCaller({ prisma, user: admin });
	}, 30_000);

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		fetchMock.mockReset();
	});

	afterAll(async () => {
		await Promise.all(uploaded.map((key) => local.deleteObject(key)));
		await prisma?.$disconnect();
		if (adminConnection) {
			await adminConnection.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
			await adminConnection.end();
		}
	});

	function event(request: Request, user: User | null = admin) {
		return { request, url: new URL(request.url), locals: { user } } as Parameters<typeof POST>[0];
	}

	async function upload() {
		const form = new FormData();
		form.append('file', new File([pdf], 'schedule.pdf', { type: 'application/pdf' }));
		const response = await POST(
			event(
				new Request('http://localhost/admin/custom-email/attachments', {
					method: 'POST',
					body: form
				})
			)
		);
		const ref = (await response.json()) as EmailAttachmentRef;
		uploaded.push(ref.key);
		return ref;
	}

	async function start(ref: EmailAttachmentRef) {
		return caller.startSend({
			subject: 'Hi {{name}}',
			body: 'Your schedule. {{hacker_qr_code}}',
			filters: { emails: [recipient.email] },
			expectedCount: 1,
			attachments: [ref]
		});
	}

	function stubDelivery() {
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockImplementation(async (url) => {
			if (String(url) !== 'https://api.resend.com/emails')
				throw new Error(`Unexpected request: ${url}`);
			return Response.json({ id: 'test-delivery' });
		});
	}

	it('uploads, previews, logs, sends a PDF and QR, and skips an already sent recipient', async () => {
		const ref = await upload();
		const preview = await GET(event(new Request(`http://localhost${attachmentPreviewUrl(ref)}`)));
		expect(preview.headers.get('Content-Type')).toBe('application/pdf');
		expect(preview.headers.get('Content-Disposition')).toContain('inline');
		expect(Buffer.from(await preview.arrayBuffer())).toEqual(pdf);
		const started = await start(ref);
		const sendId = started.sendId!;
		expect(await prisma.emailLog.findUnique({ where: { id: sendId } })).toMatchObject({
			attachments: [ref],
			sent: [],
			failed: [],
			errors: {}
		});
		stubDelivery();
		expect(await caller.sendOne({ sendId, recipient: recipient.uid })).toMatchObject({ ok: true });
		const request = fetchMock.mock.calls[0][1]!;
		const body = JSON.parse(request.body as string);
		expect(body.subject).toBe('Hi Attendee');
		expect(body.attachments).toContainEqual({
			filename: ref.filename,
			content_type: 'application/pdf',
			content: pdf.toString('base64')
		});
		expect(body.attachments).toContainEqual(
			expect.objectContaining({ content_type: 'image/png', content_id: expect.any(String) })
		);
		expect(new Headers(request.headers).get('Idempotency-Key')).toMatch(/^custom\//);
		expect(await caller.sendOne({ sendId, recipient: recipient.uid })).toMatchObject({
			skipped: true
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(await caller.finishSend({ sendId })).toMatchObject({ sent: 1, failed: 0, pending: 0 });
	});

	it('records a Resend rejection and clears the failure after a successful retry', async () => {
		const { sendId } = await start(await upload());
		stubDelivery();
		fetchMock.mockResolvedValueOnce(
			Response.json({ name: 'rate_limit_exceeded', message: 'Try later' }, { status: 429 })
		);
		vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(await caller.sendOne({ sendId: sendId!, recipient: recipient.uid })).toMatchObject({
			ok: false,
			retryable: true
		});
		expect(await caller.finishSend({ sendId: sendId! })).toMatchObject({ sent: 0, failed: 1 });
		await caller.sendOne({ sendId: sendId!, recipient: recipient.uid });
		expect(await caller.finishSend({ sendId: sendId! })).toMatchObject({
			sent: 1,
			failed: 0,
			pending: 0
		});
		expect(await prisma.emailLog.findUnique({ where: { id: sendId! } })).toMatchObject({
			errors: {}
		});
	});

	it('reuses the delivery key after the progress write fails and reports the unresolved send', async () => {
		const { sendId } = await start(await upload());
		stubDelivery();
		const update = vi
			.spyOn(prisma.emailLog, 'update')
			.mockRejectedValueOnce(new Error('connection lost'));
		await expect(caller.sendOne({ sendId: sendId!, recipient: recipient.uid })).rejects.toThrow(
			'connection lost'
		);
		expect(await caller.finishSend({ sendId: sendId! })).toMatchObject({
			sent: 0,
			failed: 0,
			pending: 1
		});
		update.mockRestore();
		await caller.sendOne({ sendId: sendId!, recipient: recipient.uid });
		const requests = fetchMock.mock.calls.map(([, init]) => init!);
		expect(new Headers(requests[0].headers).get('Idempotency-Key')).toBe(
			new Headers(requests[1].headers).get('Idempotency-Key')
		);
		expect(requests[0].body).toBe(requests[1].body);
	});

	it('refuses removed or expired files before sending or creating a send log', async () => {
		const ref = await upload();
		await DELETE(
			event(
				new Request('http://localhost/admin/custom-email/attachments', {
					method: 'DELETE',
					body: JSON.stringify({ key: ref.key })
				})
			)
		);
		const before = await prisma.emailLog.count();
		vi.spyOn(console, 'error').mockImplementation(() => {});
		await expect(start(ref)).rejects.toThrow('Remove and re-attach');
		expect(await prisma.emailLog.count()).toBe(before);
	});

	it('denies attachment access to non-admins and keys outside the attachment prefix', async () => {
		const ref = await upload();
		await expect(
			GET(event(new Request(`http://localhost${attachmentPreviewUrl(ref)}`), recipient))
		).rejects.toMatchObject({ status: 403 });
		await expect(
			GET(
				event(
					new Request(
						`http://localhost${attachmentPreviewUrl({ ...ref, key: 'applications/private' })}`
					)
				)
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('includes unsaved template attachments in the admin test email', async () => {
		const ref = await upload();
		stubDelivery();
		await caller.sendTest({
			template: 'accept',
			subject: 'Draft test',
			body: 'Draft body',
			attachments: [ref]
		});
		const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
		expect(body.to).toBe(admin.email);
		expect(body.attachments).toContainEqual({
			filename: ref.filename,
			content_type: 'application/pdf',
			content: pdf.toString('base64')
		});
	});

	it.each(TEMPLATE_KEYS)(
		'saves and sends %s attachments through its lifecycle action',
		async (key) => {
			const ref = await upload();
			const settingsCaller = settingsRouter.createCaller({ prisma, user: admin });
			const saved = await settingsCaller.updateTemplates({
				templates: {
					[key]: { subject: `${key} template`, body: 'See attached schedule.', attachments: [ref] }
				}
			});
			const [file] = storedAttachmentRefs(saved[`${key}Attachments`]);
			uploaded.push(file.key);
			expect(file.key).toMatch(/^email-template-attachments\//);
			expect((await settingsCaller.get())[`${key}Attachments`]).toEqual([file]);
			await local.deleteObject(ref.key);
			expect(await local.getObject(file.key)).toEqual(pdf);
			const dates = {
				applicationOpen: new Date(Date.now() - 86_400_000),
				applicationDeadline: new Date(Date.now() + 86_400_000),
				RSVPDeadline: null
			};
			await prisma.settings.update({ where: { id: saved.id }, data: dates });
			const decision =
				key === 'accept'
					? 'ACCEPTED'
					: key === 'reject'
						? 'REJECTED'
						: key === 'waitlist'
							? 'WAITLISTED'
							: null;
			const user = await prisma.user.create({
				data: {
					name: `${key} attendee`,
					email: `${key}@example.test`,
					role: 'HACKER',
					status: key === 'submit' ? 'CREATED' : 'APPLIED',
					pendingDecision: decision,
					activeDecision: key === 'confirm' || key === 'decline' ? 'ACCEPTED' : null
				}
			});
			stubDelivery();
			const application = applicationRouter.createCaller({ prisma, user });
			if (key === 'submit') await application.submit();
			else if (key === 'confirm') await application.rsvp();
			else if (key === 'decline') await application.rsvpDecline();
			else
				await admissionsRouter.createCaller({ prisma, user: admin }).release({ uids: [user.uid] });
			expect(fetchMock).toHaveBeenCalledTimes(1);
			const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
			expect(body.subject).toBe(`${key} template`);
			expect(body.attachments).toContainEqual({
				filename: ref.filename,
				content_type: 'application/pdf',
				content: pdf.toString('base64')
			});
			await expect(
				DELETE(
					event(
						new Request('http://localhost/admin/custom-email/attachments', {
							method: 'DELETE',
							body: JSON.stringify({ key: file.key })
						})
					)
				)
			).rejects.toMatchObject({ status: 400 });
			const view = await GET(event(new Request(`http://localhost${attachmentPreviewUrl(file)}`)));
			expect(view.status).toBe(200);
			const redacted = await settingsRouter.createCaller({ prisma, user }).get();
			expect(redacted[`${key}Attachments`]).toEqual([]);
			await settingsCaller.updateTemplates({
				templates: {
					[key]: { subject: `${key} template`, body: 'No attachment.', attachments: [] }
				}
			});
			expect(await local.exists(file.key)).toBe(false);
		}
	);

	it('retains a file until it has been removed from every template that uses it', async () => {
		const settingsCaller = settingsRouter.createCaller({ prisma, user: admin });
		const draft = { subject: 'Shared file', body: 'Schedule' };
		const saved = await settingsCaller.updateTemplates({
			templates: { accept: { ...draft, attachments: [await upload()] } }
		});
		const refs = storedAttachmentRefs(saved.acceptAttachments);
		uploaded.push(refs[0].key);
		await settingsCaller.updateTemplates({
			templates: { confirm: { ...draft, attachments: refs } }
		});
		await settingsCaller.updateTemplates({ templates: { accept: { ...draft, attachments: [] } } });
		expect(await local.exists(refs[0].key)).toBe(true);
		await settingsCaller.updateTemplates({ templates: { confirm: { ...draft, attachments: [] } } });
		expect(await local.exists(refs[0].key)).toBe(false);
	});

	it('refuses decision release when a saved template attachment is missing', async () => {
		const saved = await settingsRouter.createCaller({ prisma, user: admin }).updateTemplates({
			templates: {
				accept: { subject: 'Acceptance', body: 'See schedule.', attachments: [await upload()] }
			}
		});
		const [ref] = storedAttachmentRefs(saved.acceptAttachments);
		uploaded.push(ref.key);
		await local.deleteObject(ref.key);
		const user = await prisma.user.create({
			data: {
				name: 'Pending attendee',
				email: 'missing-file@example.test',
				role: 'HACKER',
				status: 'APPLIED',
				pendingDecision: 'ACCEPTED'
			}
		});
		stubDelivery();
		await expect(
			admissionsRouter.createCaller({ prisma, user: admin }).release({ uids: [user.uid] })
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		expect(await prisma.user.findUnique({ where: { uid: user.uid } })).toMatchObject({
			pendingDecision: 'ACCEPTED',
			activeDecision: null
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
