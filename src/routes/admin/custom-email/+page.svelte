<script lang="ts">
	import { untrack } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import { createClient } from '$lib/trpc/client';
	import {
		ALL_ROLES,
		ALL_STATUSES,
		DECISION_OPTIONS,
		allChecked,
		buildRecipientParams,
		parseEmailList,
		malformedEmails
	} from '$lib/admin/filters';
	import RecipientFilter from '$lib/components/email/RecipientFilter.svelte';
	import RecipientListModal from '$lib/components/email/RecipientListModal.svelte';
	import TemplateEditor from '$lib/components/email/TemplateEditor.svelte';
	import EmailPreview from '$lib/components/email/EmailPreview.svelte';
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
	let emailText = $state('');

	let count = $state<number | null>(untrack(() => data.recipients.count));
	let sample = $state(untrack(() => data.recipients.sample));
	let unknownEmails = $state<string[]>([]);
	let countLoading = $state(false);
	let countToken = 0;
	let listOpen = $state(false);

	let subject = $state('');
	let body = $state('');
	let confirmText = $state('');

	let sending = $state(false);
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
			: buildRecipientParams(roleFilter, statusFilter, decisionFilter)
	);
	let composeReady = $derived(subject.trim().length > 0 && body.trim().length > 0);
	let isDirty = $derived(subject.length > 0 || body.length > 0);

	beforeNavigate((nav) => {
		if (!isDirty || sending) return;
		if (!confirm('You have an unsent draft. Leave anyway?')) nav.cancel();
	});

	/** Re-count against the same predicate the send will use. */
	async function refreshCount() {
		const token = ++countToken;
		countLoading = true;
		try {
			const result = await trpc.email.previewRecipients.query(filters as never);
			// Ignore a stale response that lost the race to a newer one.
			if (token !== countToken) return;
			count = result.count;
			sample = result.sample;
			// Malformed entries never reach the server, so fold them in here.
			unknownEmails = [...badEmails, ...result.unknownEmails];
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
			// Fresh count at the moment of sending — filters may be stale by now.
			refreshCount();
		}
		step = next;
	}

	async function send() {
		if (confirmText !== CONFIRM_WORD || !count) return;
		sending = true;
		try {
			const result = await trpc.email.sendCustom.mutate({
				subject,
				body,
				filters: filters as never,
				// Bind the send to the number just shown in the confirm step; the server
				// refuses if the set drifted, so a stale filter can't silently mail everyone.
				expectedCount: count
			});
			toast.success(`Sent to ${pluralize(result.sent, 'user')}`);
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
		}
	}
</script>

<PageHeader title="Custom email">
	{#snippet meta()}Dev builds log to the server console.{/snippet}
</PageHeader>

<div class="flex workspace-h flex-col gap-5 overflow-y-auto">
	<div class="flex shrink-0 overflow-hidden rounded-lg border border-border bg-card shadow-sm">
		<!-- Step rail. The shared vertical Tabs, so the wizard rail and the settings
		     tabs are the same control instead of two lookalikes. -->
		<Tabs
			tabs={stepTabs}
			active={String(step)}
			orientation="vertical"
			onChange={(value) => goTo(Number(value) as 1 | 2 | 3)}
		/>

		<!-- Step body -->
		<div class="flex min-h-130 min-w-0 flex-1 flex-col gap-4 p-8">
			{#if step === 1}
				<RecipientFilter
					bind:mode
					bind:roleFilter
					bind:statusFilter
					bind:decisionFilter
					bind:emailText
					{count}
					{sample}
					{unknownEmails}
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
				<EmailPreview {subject} {body} height="sm" />
			{:else}
				<SendConfirmation
					{subject}
					{body}
					{count}
					loading={countLoading}
					{sending}
					bind:confirmText
				/>
			{/if}

			<!-- Step actions -->
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
	onClose={() => (listOpen = false)}
/>
