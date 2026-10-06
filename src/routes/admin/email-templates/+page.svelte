<script lang="ts">
	import { untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { createClient } from '$lib/trpc/client';
	import { EMAIL_TEMPLATES, type TemplateKey } from '$lib/email/templates';
	import { unavailableVariables } from '$lib/email/variables';
	import { pluralize } from '$lib/format';
	import AttachmentPicker from '$lib/components/email/AttachmentPicker.svelte';
	import type { EmailAttachmentRef } from '$lib/email/attachments';
	import TemplateEditor from '$lib/components/email/TemplateEditor.svelte';
	import EmailPreview from '$lib/components/email/EmailPreview.svelte';
	import Toast from '$lib/components/legacy/Toast.svelte';
	import UnsavedChangesModal from '$lib/components/admin/UnsavedChangesModal.svelte';
	import { createUnsavedGuard } from '$lib/admin/unsavedGuard.svelte';
	import { Role } from '$lib/generated/prisma/enums';
	import { APPLICANT_ROLES } from '$lib/admissions/roles';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const trpc = createClient();

	type SubTab = 'default' | Role;

	type Draft = { subject: string; body: string; attachments: EmailAttachmentRef[] };
	type OverrideDraft = {
		enabled: boolean;
		subject: string;
		body: string;
		attachments: EmailAttachmentRef[];
	};

	/** Build one default draft per template from saved Settings columns. */
	function extractDefaults(settings: PageData['settings']): Record<TemplateKey, Draft> {
		const row = settings as unknown as Record<string, string>;
		return Object.fromEntries(
			EMAIL_TEMPLATES.map((t) => [
				t.key,
				{
					subject: row[`${t.key}Subject`] ?? '',
					body: row[`${t.key}Template`] ?? '',
					attachments: (settings[`${t.key}Attachments`] ?? []) as EmailAttachmentRef[]
				}
			])
		) as Record<TemplateKey, Draft>;
	}

	/** Build override drafts keyed by templateKey → role. */
	function extractOverrides(
		overrides: PageData['overrides']
	): Record<TemplateKey, Partial<Record<Role, OverrideDraft>>> {
		const result = Object.fromEntries(EMAIL_TEMPLATES.map((t) => [t.key, {}])) as Record<
			TemplateKey,
			Partial<Record<Role, OverrideDraft>>
		>;
		for (const o of overrides) {
			const key = o.templateKey as TemplateKey;
			result[key][o.role] = {
				enabled: true,
				subject: o.subject,
				body: o.body,
				attachments: (o.attachments as EmailAttachmentRef[]) ?? []
			};
		}
		return result;
	}

	function emptyOverride(): OverrideDraft {
		return { enabled: false, subject: '', body: '', attachments: [] };
	}

	// `saved*` = last-known-persisted baseline; `drafts*` = what the admin edits.
	const unavailable = $derived(unavailableVariables(data.settings));

	let savedDefaults = $state(untrack(() => extractDefaults(data.settings)));
	let draftDefaults = $state(untrack(() => extractDefaults(data.settings)));

	let savedOverrides = $state(untrack(() => extractOverrides(data.overrides)));
	let draftOverrides = $state(untrack(() => extractOverrides(data.overrides)));

	let active = $state<TemplateKey>('submit');
	let activeSubTab = $state<SubTab>('default');
	let saving = $state(false);
	let sendingTest = $state(false);
	let uploading = $state(false);
	/** Send Test always goes to the admin's own inbox; see email.sendTest. */
	const adminEmail = untrack(() => data.adminEmail);
	let lastSavedAt = $state<Date | null>(null);
	let toast = $state<{ message: string; type: 'success' | 'error' } | null>(null);
	let toastTimer: ReturnType<typeof setTimeout>;

	/** Reset sub-tab to default when switching templates. */
	function switchTemplate(key: TemplateKey) {
		active = key;
		activeSubTab = 'default';
	}

	function draftOverride(key: TemplateKey, role: Role): OverrideDraft {
		return draftOverrides[key][role] ?? emptyOverride();
	}

	function savedOverride(key: TemplateKey, role: Role): OverrideDraft {
		return savedOverrides[key][role] ?? emptyOverride();
	}

	/** True if the default draft for `key` has unsaved changes. */
	function defaultDirty(key: TemplateKey): boolean {
		const d = draftDefaults[key];
		const s = savedDefaults[key];
		return (
			d.subject !== s.subject ||
			d.body !== s.body ||
			JSON.stringify(d.attachments) !== JSON.stringify(s.attachments)
		);
	}

	/** True if any override draft for `key` has unsaved changes. */
	function overridesDirty(key: TemplateKey): boolean {
		return APPLICANT_ROLES.some((role) => {
			const d = draftOverride(key, role);
			const s = savedOverride(key, role);
			return (
				d.enabled !== s.enabled ||
				(d.enabled &&
					(d.subject !== s.subject ||
						d.body !== s.body ||
						JSON.stringify(d.attachments) !== JSON.stringify(s.attachments)))
			);
		});
	}

	let dirtyKeys = $derived(
		EMAIL_TEMPLATES.map((t) => t.key).filter((k) => defaultDirty(k) || overridesDirty(k))
	);
	let isDirty = $derived(dirtyKeys.length > 0);
	let activeMeta = $derived(EMAIL_TEMPLATES.find((t) => t.key === active)!);

	/** The draft for the currently active sub-tab (default or a role override). */
	let activeDraft = $derived(
		activeSubTab === 'default' ? draftDefaults[active] : draftOverride(active, activeSubTab as Role)
	);

	let savedLabel = $derived(
		lastSavedAt?.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) ?? ''
	);

	const guard = createUnsavedGuard(() => isDirty || uploading);

	async function saveAndLeave() {
		await save();
		if (isDirty || uploading) guard.dismiss();
		else guard.proceed();
	}

	function showToast(message: string, type: 'success' | 'error' = 'success') {
		clearTimeout(toastTimer);
		toast = { message, type };
		toastTimer = setTimeout(() => (toast = null), 3200);
	}

	function revertActive() {
		if (activeSubTab === 'default') {
			draftDefaults[active] = { ...savedDefaults[active] };
		} else {
			const role = activeSubTab as Role;
			draftOverrides[active][role] = { ...savedOverride(active, role) };
		}
	}

	async function save() {
		if (!isDirty || saving || uploading) return;
		saving = true;
		try {
			// 1. Save dirty default templates.
			const dirtyDefaultKeys = EMAIL_TEMPLATES.map((t) => t.key).filter(defaultDirty);
			if (dirtyDefaultKeys.length > 0) {
				const templates = Object.fromEntries(
					dirtyDefaultKeys.map((k) => [k, $state.snapshot(draftDefaults[k])])
				);
				const updated = await trpc.settings.updateTemplates.mutate({ templates });
				savedDefaults = extractDefaults(updated);
				for (const key of dirtyDefaultKeys) {
					draftDefaults[key].attachments = savedDefaults[key].attachments;
				}
			}

			// 2. Save dirty overrides.
			for (const key of EMAIL_TEMPLATES.map((t) => t.key)) {
				for (const role of APPLICANT_ROLES) {
					const d = draftOverride(key, role);
					const s = savedOverride(key, role);
					const changed =
						d.enabled !== s.enabled ||
						(d.enabled &&
							(d.subject !== s.subject ||
								d.body !== s.body ||
								JSON.stringify(d.attachments) !== JSON.stringify(s.attachments)));
					if (!changed) continue;

					if (d.enabled) {
						const saved = await trpc.settings.upsertTemplateOverride.mutate({
							templateKey: key,
							role,
							subject: d.subject,
							body: d.body,
							attachments: $state.snapshot(d.attachments)
						});
						savedOverrides[key][role] = {
							enabled: true,
							subject: saved.subject,
							body: saved.body,
							attachments: (saved.attachments as EmailAttachmentRef[]) ?? []
						};
						draftOverrides[key][role]!.attachments = savedOverrides[key][role]!.attachments;
					} else {
						await trpc.settings.deleteTemplateOverride.mutate({ templateKey: key, role });
						delete savedOverrides[key][role];
					}
				}
			}

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
			const draft =
				activeSubTab === 'default'
					? draftDefaults[active]
					: (draftOverride(active, activeSubTab as Role) as Draft);

			const { to, qrAttached } = await trpc.email.sendTest.mutate({
				template: active,
				subject: draft.subject,
				body: draft.body,
				attachments: draft.attachments
			});
			if (draft.body.includes('{{hacker_qr_code}}') && !qrAttached) {
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

	function toggleOverride(role: Role) {
		const current = draftOverride(active, role);
		if (!current.enabled) {
			// Enable: seed subject/body from the current default so there's something to edit.
			draftOverrides[active][role] = {
				enabled: true,
				subject: draftDefaults[active].subject,
				body: draftDefaults[active].body,
				attachments: []
			};
		} else {
			draftOverrides[active][role] = { ...current, enabled: false };
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
			disabled={saving || uploading || sendingTest || !isDirty}
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
				onclick={() => switchTemplate(t.key)}
				disabled={uploading || saving || sendingTest}
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

	<div class="min-w-0 flex-1 space-y-4 overflow-y-auto p-4 md:p-8">
		<div>
			<h2 class="text-[15px] font-semibold text-primary">{activeMeta.label}</h2>
			<p class="mt-0.5 text-xs text-muted-foreground">{activeMeta.description}</p>
		</div>

		<!-- Sub-tabs: Default + one per applicant role -->
		<div class="flex flex-wrap gap-1 border-b border-border pb-3">
			<button
				onclick={() => (activeSubTab = 'default')}
				disabled={saving || uploading || sendingTest}
				class="rounded px-3 py-1.5 text-[12px] font-medium transition-colors {activeSubTab ===
				'default'
					? 'bg-primary text-white'
					: 'bg-muted text-primary hover:bg-[#e0e0e0]'}"
			>
				Default
			</button>
			{#each APPLICANT_ROLES as role (role)}
				{@const overrideDraft = draftOverride(active, role)}
				{@const label = role.charAt(0) + role.slice(1).toLowerCase()}
				<button
					onclick={() => (activeSubTab = role)}
					disabled={saving || uploading || sendingTest}
					class="flex items-center gap-1.5 rounded px-3 py-1.5 text-[12px] font-medium transition-colors {activeSubTab ===
					role
						? 'bg-primary text-white'
						: 'bg-muted text-primary hover:bg-[#e0e0e0]'}"
				>
					{label}
					{#if overrideDraft.enabled}
						<span
							class="h-1.5 w-1.5 rounded-full {activeSubTab === role ? 'bg-white' : 'bg-primary'}"
							title="Override active"
						></span>
					{/if}
				</button>
			{/each}
		</div>

		{#if activeSubTab === 'default'}
			<!-- Default template editor -->
			<TemplateEditor
				label={activeMeta.label}
				bind:subject={draftDefaults[active].subject}
				bind:body={draftDefaults[active].body}
				{unavailable}
			/>

			<AttachmentPicker
				bind:attachments={draftDefaults[active].attachments}
				bind:uploading
				disabled={saving || sendingTest}
				onError={(message) => showToast(message, 'error')}
			/>
			<p class="text-xs text-muted-foreground">
				Saved files are included in every email sent with this template. Removal takes effect when
				you save.
			</p>

			{#key active}
				<EmailPreview subject={draftDefaults[active].subject} body={draftDefaults[active].body} />
			{/key}
		{:else}
			<!-- Role override editor -->
			{@const role = activeSubTab as Role}
			{@const overrideDraft = draftOverride(active, role)}
			{@const roleLabel = role.charAt(0) + role.slice(1).toLowerCase()}

			<div
				class="flex items-center justify-between rounded-md border border-border bg-muted/50 px-4 py-3"
			>
				<div>
					<p class="text-[13px] font-medium text-primary">
						{roleLabel}-specific override
					</p>
					<p class="mt-0.5 text-xs text-muted-foreground">
						{#if overrideDraft.enabled}
							{roleLabel.charAt(0).toUpperCase() + roleLabel.slice(1)}s receive this template
							instead of the default.
						{:else}
							{roleLabel.charAt(0).toUpperCase() + roleLabel.slice(1)}s receive the default
							template.
						{/if}
					</p>
				</div>
				<button
					onclick={() => toggleOverride(role)}
					disabled={saving || uploading || sendingTest}
					class="shrink-0 cursor-pointer rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50 {overrideDraft.enabled
						? 'border-primary bg-primary text-white hover:bg-primary/90'
						: 'border-border bg-white text-primary hover:bg-muted'}"
				>
					{overrideDraft.enabled ? 'Override on' : 'Enable override'}
				</button>
			</div>

			{#if overrideDraft.enabled}
				<TemplateEditor
					label="{roleLabel} override"
					bind:subject={draftOverrides[active][role]!.subject}
					bind:body={draftOverrides[active][role]!.body}
					{unavailable}
				/>

				<AttachmentPicker
					bind:attachments={draftOverrides[active][role]!.attachments}
					bind:uploading
					disabled={saving || sendingTest}
					onError={(message) => showToast(message, 'error')}
				/>
				<p class="text-xs text-muted-foreground">
					Attachments here are only included in the {roleLabel} override email.
				</p>

				{#key `${active}:${role}`}
					<EmailPreview
						subject={draftOverrides[active][role]!.subject}
						body={draftOverrides[active][role]!.body}
					/>
				{/key}
			{/if}
		{/if}

		<!-- Actions pinned to the bottom. Wraps below md: the test-address line
		     takes its own row so the buttons stay reachable at 320px. -->
		<div class="flex shrink-0 flex-wrap items-center gap-2 border-t border-border pt-4">
			<span
				class="w-full truncate text-[13px] text-muted-foreground md:w-auto md:shrink-0"
				title="Test sends go to your own inbox"
			>
				Test → {adminEmail}
			</span>
			<button
				onclick={sendTest}
				disabled={sendingTest ||
					saving ||
					uploading ||
					!activeDraft.subject ||
					!activeDraft.body ||
					(activeSubTab !== 'default' && !(activeDraft as OverrideDraft).enabled)}
				class="shrink-0 cursor-pointer rounded-md border border-border bg-white px-[14px] py-[9px] text-[13px] font-medium whitespace-nowrap text-primary disabled:opacity-50"
			>
				{sendingTest ? 'Sending…' : 'Send Test'}
			</button>
			<button
				onclick={revertActive}
				disabled={saving ||
					uploading ||
					sendingTest ||
					!(activeSubTab === 'default' ? defaultDirty(active) : overridesDirty(active))}
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
