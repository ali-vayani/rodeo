<script lang="ts">
	import { untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { createClient } from '$lib/trpc/client';
	import { EMAIL_TEMPLATES, type TemplateKey } from '$lib/email/templates';
	import { unavailableVariables } from '$lib/email/variables';
	import { pluralize } from '$lib/format';
	import TemplateEditor from '$lib/components/email/TemplateEditor.svelte';
	import EmailPreview from '$lib/components/email/EmailPreview.svelte';
	import Toast from '$lib/components/legacy/Toast.svelte';
	import UnsavedChangesModal from '$lib/components/admin/UnsavedChangesModal.svelte';
	import { createUnsavedGuard } from '$lib/admin/unsavedGuard.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const trpc = createClient();

	type Draft = { subject: string; body: string };

	/** Pull the 12 template columns into `{ [key]: { subject, body } }`. */
	function extract(settings: PageData['settings']): Record<TemplateKey, Draft> {
		const row = settings as unknown as Record<string, string>;
		return Object.fromEntries(
			EMAIL_TEMPLATES.map((t) => [
				t.key,
				{ subject: row[`${t.key}Subject`] ?? '', body: row[`${t.key}Template`] ?? '' }
			])
		) as Record<TemplateKey, Draft>;
	}

	// `saved` is the last-known-persisted baseline; `drafts` is what the admin edits.
	// Both are $state so resetting the baseline after a save re-runs the deriveds below.
	// Greys out the chips for variables this event has no value for; the send paths
	// refuse a template that uses one, so the editor says so before it is typed.
	const unavailable = $derived(unavailableVariables(data.settings));

	let saved = $state(untrack(() => extract(data.settings)));
	let drafts = $state(untrack(() => extract(data.settings)));

	let active = $state<TemplateKey>('submit');
	let saving = $state(false);
	let sendingTest = $state(false);
	/** Send Test always goes to the admin's own inbox; see email.sendTest. */
	const adminEmail = untrack(() => data.adminEmail);
	let lastSavedAt = $state<Date | null>(null);
	let toast = $state<{ message: string; type: 'success' | 'error' } | null>(null);
	let toastTimer: ReturnType<typeof setTimeout>;

	let dirtyKeys = $derived(
		EMAIL_TEMPLATES.map((t) => t.key).filter(
			(k) => drafts[k].subject !== saved[k].subject || drafts[k].body !== saved[k].body
		)
	);
	let isDirty = $derived(dirtyKeys.length > 0);
	let activeMeta = $derived(EMAIL_TEMPLATES.find((t) => t.key === active)!);
	let savedLabel = $derived(
		lastSavedAt?.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) ?? ''
	);

	const guard = createUnsavedGuard(() => isDirty);

	/** `save` reports failure by leaving the drafts dirty, so that is the signal to stay. */
	async function saveAndLeave() {
		await save();
		if (isDirty) guard.dismiss();
		else guard.proceed();
	}

	function showToast(message: string, type: 'success' | 'error' = 'success') {
		clearTimeout(toastTimer);
		toast = { message, type };
		toastTimer = setTimeout(() => (toast = null), 3200);
	}

	function revertActive() {
		drafts[active] = { ...saved[active] };
	}

	async function save() {
		if (!isDirty) return;
		saving = true;
		try {
			const templates = Object.fromEntries(
				dirtyKeys.map((k) => [k, { subject: drafts[k].subject, body: drafts[k].body }])
			);
			await trpc.settings.updateTemplates.mutate({ templates });
			saved = structuredClone($state.snapshot(drafts));
			lastSavedAt = new Date();
			showToast('Templates saved');
		} catch (e: unknown) {
			showToast(e instanceof Error ? e.message : 'Failed to save templates', 'error');
		} finally {
			saving = false;
		}
	}

	async function sendTest() {
		sendingTest = true;
		try {
			const { to, qrAttached } = await trpc.email.sendTest.mutate({
				template: active,
				subject: drafts[active].subject,
				body: drafts[active].body
			});
			if (drafts[active].body.includes('{{hacker_qr_code}}') && !qrAttached) {
				showToast(
					`Test sent to ${to}, but without the QR code — set the event dates in Settings first`,
					'error'
				);
			} else {
				showToast(`Test email sent to ${to}`);
			}
		} catch (e: unknown) {
			showToast(e instanceof Error ? e.message : 'Failed to send test email', 'error');
		} finally {
			sendingTest = false;
		}
	}
</script>

<div class="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
	<h1 class="text-[22px] font-bold text-primary">Email Templates</h1>
	<div class="flex items-center gap-3">
		<span class="font-mono text-[11px] text-muted-foreground">
			{#if isDirty}
				{dirtyKeys.length} unsaved
			{:else if lastSavedAt}
				Saved {savedLabel}
			{/if}
		</span>
		<button
			onclick={save}
			disabled={saving || !isDirty}
			class="cursor-pointer rounded-md border-none bg-primary px-[18px] py-[9px] text-[13px] font-semibold text-white disabled:opacity-50"
		>
			{saving ? 'Saving…' : 'Save Changes'}
		</button>
	</div>
</div>

<!-- Below md the fixed-height split becomes a natural-height stack: the rail
     flattens into a horizontal scroll strip on top, and the page scrolls. -->
<div
	class="flex flex-col rounded-md border border-border bg-white md:h-[calc(100vh-136px)] md:flex-row md:overflow-hidden"
>
	<div
		class="flex flex-row overflow-x-auto border-b border-border bg-muted md:w-[160px] md:shrink-0 md:flex-col md:overflow-x-visible md:border-r md:border-b-0"
	>
		<div
			class="hidden border-b border-border px-3 py-[11px] text-[10px] font-bold tracking-widest text-muted-foreground uppercase md:block"
		>
			Templates
		</div>
		{#each EMAIL_TEMPLATES as t (t.key)}
			<button
				onclick={() => (active = t.key)}
				class="flex shrink-0 cursor-pointer items-center justify-between gap-2 border-border px-4 py-[11px] text-left text-[13px] whitespace-nowrap transition-colors md:shrink md:border-b md:whitespace-normal {active ===
				t.key
					? 'bg-white font-semibold text-primary'
					: 'bg-transparent text-primary hover:bg-[#ebebeb]'}"
			>
				<span>{t.label}</span>
				{#if dirtyKeys.includes(t.key)}
					<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" title="Unsaved changes"></span>
				{/if}
			</button>
		{/each}
	</div>

	<div class="flex min-w-0 flex-1 flex-col gap-4 p-4 md:p-8">
		<div>
			<h2 class="text-[15px] font-semibold text-primary">{activeMeta.label}</h2>
			<p class="mt-0.5 text-xs text-muted-foreground">{activeMeta.description}</p>
		</div>

		<TemplateEditor
			label={activeMeta.label}
			bind:subject={drafts[active].subject}
			bind:body={drafts[active].body}
			{unavailable}
		/>

		<!-- Remount on switch so the preview shows the new template immediately
		     instead of waiting out the debounce on the old one. -->
		{#key active}
			<EmailPreview subject={drafts[active].subject} body={drafts[active].body} />
		{/key}

		<!-- Actions pinned to the bottom. Wraps below md: the test-address line
		     takes its own row so the buttons stay reachable at 320px. -->
		<div class="mt-auto flex shrink-0 flex-wrap items-center gap-2 border-t border-border pt-4">
			<span
				class="w-full truncate text-[13px] text-muted-foreground md:w-auto md:shrink-0"
				title="Test sends go to your own inbox"
			>
				Test → {adminEmail}
			</span>
			<button
				onclick={sendTest}
				disabled={sendingTest || !drafts[active].subject || !drafts[active].body}
				class="shrink-0 cursor-pointer rounded-md border border-border bg-white px-[14px] py-[9px] text-[13px] font-medium whitespace-nowrap text-primary disabled:opacity-50"
			>
				{sendingTest ? 'Sending…' : 'Send Test'}
			</button>
			<button
				onclick={revertActive}
				disabled={!dirtyKeys.includes(active)}
				class="shrink-0 cursor-pointer rounded-md border border-border bg-white px-[14px] py-[9px] text-[13px] font-medium whitespace-nowrap text-primary disabled:opacity-50"
			>
				Revert
			</button>
			<span class="ml-auto min-w-0 truncate text-xs text-muted-foreground">
				Dev builds log to the server console.
			</span>
		</div>
	</div>
</div>

{#if toast}
	<div
		in:fly={{ x: 60, duration: 280 }}
		out:fly={{ x: 60, duration: 200 }}
		class="fixed right-7 bottom-7 z-[200]"
	>
		<Toast message={toast.message} type={toast.type} />
	</div>
{/if}

<UnsavedChangesModal
	open={guard.open}
	description="{pluralize(dirtyKeys.length, 'template')} {dirtyKeys.length === 1
		? 'has'
		: 'have'} unsaved changes. Save them before leaving?"
	{saving}
	onSave={saveAndLeave}
	onDiscard={guard.proceed}
	onCancel={guard.dismiss}
/>
