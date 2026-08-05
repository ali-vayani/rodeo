<script lang="ts">
	import { untrack } from 'svelte';
	import { fly } from 'svelte/transition';
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
	import Toast from '$lib/components/legacy/Toast.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const trpc = createClient();

	const STEPS = [
		{ n: 1, label: 'Recipients' },
		{ n: 2, label: 'Compose' },
		{ n: 3, label: 'Confirm' }
	] as const;

	let step = $state<1 | 2 | 3>(1);

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
	let toast = $state<{ message: string; type: 'success' | 'error' } | null>(null);
	let toastTimer: ReturnType<typeof setTimeout>;
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

	function showToast(message: string, type: 'success' | 'error' = 'success') {
		clearTimeout(toastTimer);
		toast = { message, type };
		toastTimer = setTimeout(() => (toast = null), 3200);
	}

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
			showToast(e instanceof Error ? e.message : 'Failed to count recipients', 'error');
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
				filters: filters as never
			});
			showToast(`Sent to ${result.sent} user${result.sent === 1 ? '' : 's'}`);
			const refreshed = await trpc.email.getLogs.query({ page: 1, pageSize: 10 });
			logs = refreshed.logs;
			subject = '';
			body = '';
			confirmText = '';
			step = 1;
		} catch (e: unknown) {
			showToast(e instanceof Error ? e.message : 'Failed to send', 'error');
		} finally {
			sending = false;
		}
	}
</script>

<!-- Page header -->
<div class="mb-4 flex items-center justify-between">
	<h1 class="text-[22px] font-bold text-primary">Custom Email</h1>
	<span class="font-mono text-[11px] text-muted-foreground">
		Dev builds log to the server console.
	</span>
</div>

<div class="flex h-[calc(100vh-136px)] flex-col gap-5 overflow-y-auto">
	<div class="flex shrink-0 overflow-hidden rounded-md border border-border bg-white">
		<!-- Step rail -->
		<div class="flex w-[160px] shrink-0 flex-col border-r border-border bg-muted">
			<div
				class="border-b border-border px-3 py-[11px] text-[10px] font-bold tracking-widest text-muted-foreground uppercase"
			>
				Steps
			</div>
			{#each STEPS as s (s.n)}
				<button
					onclick={() => goTo(s.n)}
					disabled={s.n > step}
					class="flex items-center gap-2 border-b border-border px-4 py-[11px] text-left text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 {step ===
					s.n
						? 'bg-white font-semibold text-primary'
						: s.n < step
							? 'cursor-pointer bg-transparent text-[#555] hover:bg-[#ebebeb]'
							: 'bg-transparent text-muted-foreground'}"
				>
					<span class="font-mono text-[11px]">{s.n}</span>
					<span>{s.label}</span>
				</button>
			{/each}
		</div>

		<!-- Step body -->
		<div class="flex min-w-0 flex-1 flex-col gap-4 p-8" style="min-height: 520px">
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
					<h2 class="text-[15px] font-semibold text-primary">Compose</h2>
					<p class="mt-0.5 text-xs text-muted-foreground">
						Variables are substituted per recipient when the email is sent.
					</p>
				</div>
				<TemplateEditor label="Custom" bind:subject bind:body />
				<EmailPreview {subject} {body} height="h-[150px]" />
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
					<button
						onclick={() => goTo((step - 1) as 1 | 2)}
						disabled={sending}
						class="cursor-pointer rounded-md border border-border bg-white px-[14px] py-[9px] text-[13px] font-medium whitespace-nowrap text-primary disabled:opacity-50"
					>
						Back
					</button>
				{/if}

				{#if step === 1}
					<button
						onclick={() => goTo(2)}
						disabled={countLoading || !count}
						class="ml-auto cursor-pointer rounded-md border-none bg-primary px-[18px] py-[9px] text-[13px] font-semibold whitespace-nowrap text-white disabled:opacity-50"
					>
						Next: Compose →
					</button>
				{:else if step === 2}
					<button
						onclick={() => goTo(3)}
						disabled={!composeReady}
						class="ml-auto cursor-pointer rounded-md border-none bg-primary px-[18px] py-[9px] text-[13px] font-semibold whitespace-nowrap text-white disabled:opacity-50"
					>
						Next: Confirm →
					</button>
				{:else}
					<button
						onclick={send}
						disabled={sending || countLoading || !count || confirmText !== CONFIRM_WORD}
						class="ml-auto cursor-pointer rounded-md border-none bg-destructive px-[18px] py-[9px] text-[13px] font-semibold whitespace-nowrap text-white disabled:opacity-50"
					>
						{sending ? 'Sending…' : `Send to ${count ?? 0} ${count === 1 ? 'person' : 'people'}`}
					</button>
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

<!-- Toast -->
{#if toast}
	<div
		in:fly={{ x: 60, duration: 280 }}
		out:fly={{ x: 60, duration: 200 }}
		class="fixed right-7 bottom-7 z-[200]"
	>
		<Toast message={toast.message} type={toast.type} />
	</div>
{/if}
