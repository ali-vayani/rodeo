<script lang="ts">
	import { untrack } from 'svelte';
	import { createClient } from '$lib/trpc/client';
	import {
		ALL_ROLES,
		ALL_STATUSES,
		DECISION_OPTIONS,
		allChecked,
		buildRecipientParams,
		parseEmailList
	} from '$lib/admin/filters';
	import { malformedEmails } from '$lib/email/address';
	import type { FacetState } from '$lib/facets';
	import RecipientFilter from '$lib/components/email/RecipientFilter.svelte';
	import RecipientListModal from '$lib/components/email/RecipientListModal.svelte';
	import UnsavedChangesModal from '$lib/components/admin/UnsavedChangesModal.svelte';
	import { createUnsavedGuard } from '$lib/admin/unsavedGuard.svelte';
	import TemplateEditor from '$lib/components/email/TemplateEditor.svelte';
	import EmailPreview, { type PreviewAs } from '$lib/components/email/EmailPreview.svelte';
	import { NAME_FALLBACK, SAMPLE_VARS } from '$lib/email/variables';
	import { UserStatus } from '$lib/generated/prisma/enums';
	import SendConfirmation, { CONFIRM_WORD } from '$lib/components/email/SendConfirmation.svelte';
	import SendHistory from '$lib/components/email/SendHistory.svelte';
	import { Button } from '$lib/components/ui';
	import { PageHeader, Tabs } from '$lib/components/patterns';
	import type { TabItem } from '$lib/components/ui/types';
	import { toast } from '$lib/ui/toast.svelte';
	import { pluralize } from '$lib/format';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const trpc = createClient();

	let step = $state<1 | 2 | 3>(1);

	// Steps ahead of the current one stay disabled: the wizard is strictly
	// forward-only until each stage is satisfied.
	let stepTabs = $derived<TabItem[]>(
		[
			{ value: '1', label: '1 · Recipients' },
			{ value: '2', label: '2 · Compose' },
			{ value: '3', label: '3 · Confirm' }
		].map((t) => ({ ...t, disabled: Number(t.value) > step }))
	);

	// Targeting is either/or: attribute filters, or an explicit address list. Keeping
	// them mutually exclusive avoids "does this union or intersect?" ambiguity.
	let mode = $state<'filters' | 'emails'>('filters');

	// Every box checked means "no filter", i.e. everyone.
	let roleFilter = $state(allChecked(ALL_ROLES));
	let statusFilter = $state(allChecked(ALL_STATUSES));
	let decisionFilter = $state(allChecked(DECISION_OPTIONS));
	// The application-answer facets run the other way round: nothing selected is the
	// "everyone" default, and `buildRecipientParams` omits an untouched facet's key
	// rather than sending `[]`, which the send path would read as "nobody".
	let facetSelection = $state<FacetState>({});
	let emailText = $state('');

	// Off by default: with it on, an address that matches no account is mailed instead
	// of flagged, which is the only way this page reaches outside the portal.
	let allowExternal = $state(false);

	let count = $state<number | null>(untrack(() => data.recipients.count));
	let sample = $state(untrack(() => data.recipients.sample));
	let unknownEmails = $state<string[]>([]);
	let externalEmails = $state<string[]>([]);
	/** Entries the server refused as addresses, merged with the ones caught client-side. */
	let invalidEmails = $state<string[]>([]);
	let countLoading = $state(false);
	let countToken = 0;
	let listOpen = $state(false);

	let subject = $state('');
	let body = $state('');
	let confirmText = $state('');

	/**
	 * Resend allows 10 requests/second per team and answers a burst past it with a 429.
	 * The gap between sends targets roughly 8/s to leave headroom; the round trip usually
	 * costs more than this anyway, so it is a floor on the interval, not the real rate.
	 */
	const SEND_INTERVAL_MS = 125;
	/** Long enough for the rate-limit window to clear before a retried send goes again. */
	const RETRY_BACKOFF_MS = 1000;
	const MAX_ATTEMPTS = 3;

	const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

	let sending = $state(false);
	/** Live count while the send loop runs; null when idle. */
	let progress = $state<{ done: number; total: number } | null>(null);
	let logs = $state(untrack(() => data.history.logs));
	let debounceTimer: ReturnType<typeof setTimeout>;

	let parsedEmails = $derived(parseEmailList(emailText));
	let badEmails = $derived(malformedEmails(parsedEmails));

	let filters = $derived(
		mode === 'emails'
			? // Only well-formed addresses go to the server; malformed ones are surfaced
				// in the UI instead. An empty list stays an empty array, which the
				// where-builder reads as "nobody" rather than "everybody".
				{ emails: parsedEmails.filter((e) => !badEmails.includes(e)) }
			: buildRecipientParams(roleFilter, statusFilter, decisionFilter, '', facetSelection)
	);
	let composeReady = $derived(subject.trim().length > 0 && body.trim().length > 0);
	let isDirty = $derived(subject.length > 0 || body.length > 0);

	// The toggle only means anything for an explicit address list; in filter mode there
	// are no unmatched addresses for it to admit. Sent explicitly rather than inferred.
	let sendExternal = $derived(mode === 'emails' && allowExternal);
	let badOrInvalid = $derived([...new Set([...badEmails, ...invalidEmails])]);

	/**
	 * Who the compose preview substitutes against: the sampled recipients, then the
	 * external addresses. Externals carry the same fallback name the server will use.
	 */
	let previewTargets = $derived([
		...sample.map((u) => ({ name: u.name, email: u.email, status: u.status, external: false })),
		...(sendExternal
			? externalEmails.map((email) => ({
					name: NAME_FALLBACK,
					email,
					status: null,
					external: true
				}))
			: [])
	]);

	let previewCursor = $state(0);
	// Modulo rather than a clamp, so the cursor survives the list shrinking under it.
	let previewTarget = $derived(
		previewTargets.length > 0 ? previewTargets[previewCursor % previewTargets.length] : null
	);

	/**
	 * Exactly what `sendCustom` will substitute for `previewTarget`.
	 *
	 * The dates come pre-rendered from the server, since formatting them here would use
	 * the browser's locale and timezone. The blank-name fallback is applied here too, so
	 * a nameless recipient previews as the salutation they actually get.
	 */
	let previewVars = $derived(
		previewTarget === null
			? SAMPLE_VARS
			: {
					name: previewTarget.name?.trim() || NAME_FALLBACK,
					...data.eventVars,
					// The QR block is per-recipient, so the send substitutes it server-side. Mirror
					// its gate here: confirmed recipients preview the placeholder, everyone else
					// previews the nothing they will receive, never the literal {{hacker_qr_code}}.
					hacker_qr_code:
						previewTarget.status === UserStatus.CONFIRMED ||
						previewTarget.status === UserStatus.CHECKED_IN
							? SAMPLE_VARS.hacker_qr_code
							: ''
				}
	);

	let previewAs = $derived<PreviewAs>({
		name: previewTarget?.name ?? '',
		email: previewTarget?.email ?? '',
		external: previewTarget?.external ?? false,
		index: previewTargets.length > 0 ? previewCursor % previewTargets.length : 0,
		total: previewTargets.length,
		onNext: () => (previewCursor += 1)
	});

	// A draft here has nowhere to be saved to — it is composed and sent, or discarded —
	// so the modal offers no save action. Guarding while `sending` matters more than the
	// draft does: the send loop runs in this page, so leaving abandons the recipients it
	// has not reached yet.
	const guard = createUnsavedGuard(() => sending || isDirty);

	/** Re-count against the same predicate the send will use. */
	async function refreshCount() {
		const token = ++countToken;
		countLoading = true;
		try {
			const result = await trpc.email.previewRecipients.query({
				...filters,
				allowExternal: sendExternal
			} as never);
			// Ignore a stale response that lost the race to a newer one.
			if (token !== countToken) return;
			count = result.count;
			sample = result.sample;
			unknownEmails = result.unknownEmails;
			externalEmails = result.externalEmails;
			invalidEmails = result.invalidEmails;
		} catch (e: unknown) {
			if (token !== countToken) return;
			count = null;
			toast.fromError(e, 'Failed to count recipients');
		} finally {
			if (token === countToken) countLoading = false;
		}
	}

	function onFiltersChanged() {
		clearTimeout(debounceTimer);
		countLoading = true;
		debounceTimer = setTimeout(refreshCount, 300);
	}

	function goTo(next: 1 | 2 | 3) {
		if (next === 3) {
			confirmText = '';
			// Fresh count at the moment of sending; the filters may be stale by now.
			refreshCount();
		}
		step = next;
	}

	/**
	 * Mails the recipient list one message at a time.
	 *
	 * The pacing lives here rather than on the server because Resend caps a team at 10
	 * requests/second: a few hundred recipients take longer than a serverless function
	 * is allowed to run, while a browser tab can sit in the loop as long as it needs and
	 * show a running count while it does.
	 *
	 * Closing the tab stops the send. `startSend` has already recorded the full recipient
	 * list, and each delivery is marked against it, so what got out stays visible in the
	 * history and a second run skips anyone already reached.
	 */
	async function send() {
		if (confirmText !== CONFIRM_WORD || !count) return;
		sending = true;
		progress = null;
		try {
			const started = await trpc.email.startSend.mutate({
				subject,
				body,
				filters: filters as never,
				// Bind the send to the number just shown in the confirm step. The server refuses if
				// the set drifted, so a stale filter cannot silently mail everyone. External
				// recipients are inside that number, not alongside it.
				expectedCount: count,
				allowExternal: sendExternal
			});

			const sendId = started.sendId;
			if (sendId === null) {
				toast.error('Nobody matched — nothing was sent.');
				return;
			}

			const queue = started.recipients.map((recipient) => ({ recipient, attempt: 1 }));
			progress = { done: 0, total: queue.length };

			while (queue.length > 0) {
				const job = queue.shift()!;
				// A dropped connection is indistinguishable from a paced-out send from here, and
				// both are worth another go, so a thrown request joins the retryable failures.
				const result = await trpc.email.sendOne
					.mutate({ sendId, recipient: job.recipient })
					.catch(() => ({ ok: false, retryable: true }));

				if (!result.ok && result.retryable && job.attempt < MAX_ATTEMPTS) {
					// To the back, so one struggling recipient does not hold up the rest.
					queue.push({ recipient: job.recipient, attempt: job.attempt + 1 });
					await sleep(RETRY_BACKOFF_MS);
					continue;
				}

				progress.done += 1;
				if (queue.length > 0) await sleep(SEND_INTERVAL_MS);
			}

			const result = await trpc.email.finishSend.mutate({ sendId });
			if (result.failed > 0) {
				toast.error(
					`Sent ${result.sent} of ${result.total} — ${result.failed} failed. See the send history.`
				);
			} else {
				toast.success(
					started.external > 0
						? `Sent to ${pluralize(result.sent, 'recipient')}, ${started.external} external`
						: `Sent to ${pluralize(result.sent, 'user')}`
				);
			}

			const refreshed = await trpc.email.getLogs.query({ page: 1, pageSize: 10 });
			logs = refreshed.logs;
			subject = '';
			body = '';
			confirmText = '';
			step = 1;
		} catch (e: unknown) {
			toast.fromError(e, 'Failed to send');
		} finally {
			sending = false;
			progress = null;
		}
	}
</script>

<PageHeader title="Custom email">
	{#snippet meta()}Dev builds log to the server console.{/snippet}
</PageHeader>

<div class="flex workspace-h flex-col gap-5 overflow-y-auto">
	<!-- Below md the step rail (the vertical Tabs, which self-flattens into a
	     horizontal strip) stacks on top of the step body. -->
	<div
		class="flex shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm md:flex-row"
	>
		<!-- Step rail. The shared vertical Tabs, so the wizard rail and the settings
		     tabs are the same control instead of two lookalikes. -->
		<Tabs
			tabs={stepTabs}
			active={String(step)}
			orientation="vertical"
			onChange={(value) => goTo(Number(value) as 1 | 2 | 3)}
		/>

		<div class="flex min-w-0 flex-1 flex-col gap-4 p-4 md:min-h-130 md:p-8">
			{#if step === 1}
				<RecipientFilter
					bind:mode
					bind:roleFilter
					bind:statusFilter
					bind:decisionFilter
					bind:selection={facetSelection}
					facets={data.facets}
					bind:emailText
					bind:allowExternal
					{count}
					{sample}
					{unknownEmails}
					badEmails={badOrInvalid}
					{externalEmails}
					loading={countLoading}
					onChange={onFiltersChanged}
					onShowAll={() => (listOpen = true)}
				/>
			{:else if step === 2}
				<div>
					<h2 class="m-0 text-lg font-semibold text-foreground">Compose</h2>
					<p class="mt-0.5 mb-0 text-xs text-foreground-secondary">
						Variables are substituted per recipient when the email is sent.
					</p>
				</div>
				<TemplateEditor label="Custom" bind:subject bind:body />
				<EmailPreview {subject} {body} vars={previewVars} {previewAs} height="sm" />
			{:else}
				<SendConfirmation
					{subject}
					{body}
					{count}
					externalCount={sendExternal ? externalEmails.length : 0}
					vars={previewVars}
					{previewAs}
					loading={countLoading}
					{sending}
					bind:confirmText
				/>
			{/if}

			<div class="mt-auto flex shrink-0 items-center gap-2 border-t border-border pt-4">
				{#if step > 1}
					<Button onclick={() => goTo((step - 1) as 1 | 2)} disabled={sending}>Back</Button>
				{/if}

				{#if step === 1}
					<Button
						variant="primary"
						class="ml-auto"
						onclick={() => goTo(2)}
						disabled={countLoading || !count}
					>
						Next: Compose →
					</Button>
				{:else if step === 2}
					<Button
						variant="primary"
						class="ml-auto"
						onclick={() => goTo(3)}
						disabled={!composeReady}
					>
						Next: Confirm →
					</Button>
				{:else}
					{#if progress}
						<!-- A blast is paced at a few per second, so this is the only sign the page
						     is still working. Keep it beside the button, not in a toast. -->
						<span class="text-base text-muted-foreground" aria-live="polite">
							Sending {progress.done} of {progress.total}…
						</span>
					{/if}
					<Button
						variant="danger"
						class="ml-auto"
						onclick={send}
						loading={sending}
						disabled={countLoading || !count || confirmText !== CONFIRM_WORD}
					>
						Send to {pluralize(count ?? 0, 'person', 'people')}
					</Button>
				{/if}
			</div>
		</div>
	</div>

	<SendHistory {logs} />
	<div class="h-2 shrink-0"></div>
</div>

<RecipientListModal
	open={listOpen}
	{filters}
	total={count ?? 0}
	externalEmails={sendExternal ? externalEmails : []}
	onClose={() => (listOpen = false)}
/>

<UnsavedChangesModal
	open={guard.open}
	title="Unsent draft"
	description="This email has not been sent. Leaving discards what you have written."
	discardLabel="Discard draft"
	onDiscard={guard.proceed}
	onCancel={guard.dismiss}
/>
