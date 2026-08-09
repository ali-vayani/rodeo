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
		malformedEmails,
		type LinkedSelection
	} from '$lib/admin/filters';
	import RecipientFilter from '$lib/components/email/RecipientFilter.svelte';
	import RecipientListModal from '$lib/components/email/RecipientListModal.svelte';
	import TemplateEditor from '$lib/components/email/TemplateEditor.svelte';
	import EmailPreview, { type PreviewAs } from '$lib/components/email/EmailPreview.svelte';
	import { EXTERNAL_NAME_FALLBACK, SAMPLE_VARS } from '$lib/email/variables';
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
	// The linked application fields run the other way round: nothing selected is the
	// "everyone" default, and `buildRecipientParams` omits an untouched field's key
	// rather than sending `[]` — which the send path would read as "nobody".
	let linked = $state<LinkedSelection>({});
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
			: buildRecipientParams(roleFilter, statusFilter, decisionFilter, '', linked)
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
		...sample.map((u) => ({ name: u.name, email: u.email, external: false })),
		...(sendExternal
			? externalEmails.map((email) => ({ name: EXTERNAL_NAME_FALLBACK, email, external: true }))
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
	 * The dates come pre-rendered from the server: formatting them here would use the
	 * browser's locale and timezone. `eventVars` is null when there is no Settings row,
	 * and the send substitutes nothing at all in that case — so neither does this, and
	 * the unknown-variable warning correctly says the placeholders go out as-is.
	 */
	let previewVars = $derived(
		previewTarget === null
			? SAMPLE_VARS
			: data.eventVars === null
				? {}
				: { name: previewTarget.name, ...data.eventVars }
	);

	let previewAs = $derived<PreviewAs>({
		name: previewTarget?.name ?? '',
		email: previewTarget?.email ?? '',
		external: previewTarget?.external ?? false,
		index: previewTargets.length > 0 ? previewCursor % previewTargets.length : 0,
		total: previewTargets.length,
		onNext: () => (previewCursor += 1)
	});

	beforeNavigate((nav) => {
		if (!isDirty || sending) return;
		if (!confirm('You have an unsent draft. Leave anyway?')) nav.cancel();
	});

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
				// External recipients are inside that number, not alongside it.
				expectedCount: count,
				allowExternal: sendExternal
			});
			toast.success(
				result.external > 0
					? `Sent to ${pluralize(result.sent, 'recipient')}, ${result.external} external`
					: `Sent to ${pluralize(result.sent, 'user')}`
			);
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

		<!-- Step body -->
		<div class="flex min-w-0 flex-1 flex-col gap-4 p-4 md:min-h-130 md:p-8">
			{#if step === 1}
				<RecipientFilter
					bind:mode
					bind:roleFilter
					bind:statusFilter
					bind:decisionFilter
					bind:linked
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
	externalEmails={sendExternal ? externalEmails : []}
	onClose={() => (listOpen = false)}
/>
