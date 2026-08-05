<script lang="ts">
	import { untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { createClient } from '$lib/trpc/client';
	import type { PageData } from './$types';
	import GeneralTab from '$lib/components/settings/GeneralTab.svelte';
	import DatesTab from '$lib/components/settings/DatesTab.svelte';
	import ScanGroupsTab from '$lib/components/settings/ScanGroupsTab.svelte';
	import DangerZoneTab from '$lib/components/settings/DangerZoneTab.svelte';
	import Toast from '$lib/components/ui/Toast.svelte';

	let { data }: { data: PageData } = $props();

	const trpc = createClient();

	type SettingsRow = typeof data.settings;

	let settings = $state<SettingsRow>(untrack(() => ({ ...data.settings })));
	let saving = $state(false);
	let toast = $state<{ message: string; type: 'success' | 'error' } | null>(null);
	let toastTimer: ReturnType<typeof setTimeout>;

	// Sidebar scroll-spy
	let scrollContainer = $state<HTMLElement | undefined>(undefined);
	let activeSection = $state('general');
	const sectionIds = ['general', 'dates', 'scan-groups', 'danger'];

	const sections = [
		{ id: 'general', label: 'General' },
		{ id: 'dates', label: 'Dates' },
		{ id: 'scan-groups', label: 'Scan Groups' },
		{ id: 'danger', label: 'Danger Zone' }
	];

	function handleScroll() {
		if (!scrollContainer) return;
		const containerTop = scrollContainer.getBoundingClientRect().top;
		for (let i = sectionIds.length - 1; i >= 0; i--) {
			const el = document.getElementById(`section-${sectionIds[i]}`);
			if (el && el.getBoundingClientRect().top - containerTop <= 48) {
				activeSection = sectionIds[i];
				return;
			}
		}
		activeSection = sectionIds[0];
	}

	function scrollToSection(id: string) {
		activeSection = id;
		const el = document.getElementById(`section-${id}`);
		el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	function showToast(message: string, type: 'success' | 'error' = 'success') {
		clearTimeout(toastTimer);
		toast = { message, type };
		toastTimer = setTimeout(() => (toast = null), 3200);
	}

	async function save(updates: Partial<SettingsRow>) {
		saving = true;
		try {
			const merged = { ...settings, ...updates };
			await trpc.settings.update.mutate({
				applicationOpen: merged.applicationOpen,
				applicationDeadline: merged.applicationDeadline,
				RSVPDeadline: merged.RSVPDeadline,
				admissionsSend: merged.admissionsSend ?? undefined,
				hackathonStartDate: merged.hackathonStartDate,
				scanActions: merged.scanActions,
				submitTemplate: merged.submitTemplate,
				submitSubject: merged.submitSubject,
				acceptTemplate: merged.acceptTemplate,
				acceptSubject: merged.acceptSubject,
				confirmTemplate: merged.confirmTemplate,
				confirmSubject: merged.confirmSubject,
				declineTemplate: merged.declineTemplate,
				declineSubject: merged.declineSubject,
				rejectTemplate: merged.rejectTemplate,
				rejectSubject: merged.rejectSubject,
				waitlistTemplate: merged.waitlistTemplate,
				waitlistSubject: merged.waitlistSubject,
				timezone: merged.timezone
			});
			settings = { ...settings, ...updates } as SettingsRow;
			showToast('Settings saved');
		} catch (e: any) {
			showToast(e.message ?? 'Failed to save settings', 'error');
		} finally {
			saving = false;
		}
	}
</script>

<!-- Page header -->
<div class="mb-4 flex items-center justify-between">
	<h1 class="text-[22px] font-bold text-primary">Settings</h1>
</div>

<!-- Main card: sidebar + scrollable content -->
<div class="flex h-[calc(100vh-136px)] overflow-hidden rounded-md border border-border bg-white">
	<!-- Vertical sidebar (layout 5) -->
	<div class="flex w-[160px] shrink-0 flex-col border-r border-border bg-muted">
		<div
			class="border-b border-border px-3 py-[11px] text-[10px] font-bold tracking-widest text-muted-foreground uppercase"
		>
			Settings
		</div>
		{#each sections as section}
			<button
				onclick={() => scrollToSection(section.id)}
				class="cursor-pointer border-b border-border px-4 py-[11px] text-left text-[13px] transition-colors {activeSection ===
				section.id
					? 'bg-white font-semibold text-primary'
					: 'bg-transparent text-primary hover:bg-[#ebebeb]'}"
			>
				{section.label}
			</button>
		{/each}
	</div>

	<!-- Scrollable content area -->
	<div
		bind:this={scrollContainer}
		onscroll={handleScroll}
		class="flex-1 space-y-5 overflow-y-auto p-8"
	>
		<!-- General section (layout 2 bordered block) -->
		<div id="section-general" class="overflow-hidden rounded-md border border-border">
			<div class="border-b border-border bg-muted px-4 py-[9px]">
				<span class="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
					General
				</span>
			</div>
			<div class="p-6">
				<GeneralTab timezone={settings.timezone} {saving} onSave={(u) => save(u)} />
			</div>
		</div>

		<!-- Dates section -->
		<div id="section-dates" class="overflow-hidden rounded-md border border-border">
			<div class="border-b border-border bg-muted px-4 py-[9px]">
				<span class="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
					Dates
				</span>
			</div>
			<div class="p-6">
				<DatesTab
					applicationOpen={settings.applicationOpen}
					applicationDeadline={settings.applicationDeadline}
					admissionsSend={settings.admissionsSend}
					RSVPDeadline={settings.RSVPDeadline}
					hackathonStartDate={settings.hackathonStartDate}
					{saving}
					onSave={(u) => save(u)}
				/>
			</div>
		</div>

		<!-- Scan Groups section -->
		<div id="section-scan-groups" class="overflow-hidden rounded-md border border-border">
			<div class="border-b border-border bg-muted px-4 py-[9px]">
				<span class="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
					Scan Groups
				</span>
			</div>
			<div class="p-6">
				<ScanGroupsTab scanActions={settings.scanActions} {saving} onSave={(u) => save(u)} />
			</div>
		</div>

		<!-- Danger Zone section -->
		<div id="section-danger" class="overflow-hidden rounded-md border border-[#fca5a5]">
			<div class="border-b border-[#fca5a5] bg-[#fff3f3] px-4 py-[9px]">
				<span class="font-mono text-[10px] font-medium tracking-[0.1em] text-destructive uppercase">
					Danger Zone
				</span>
			</div>
			<div class="p-6">
				<DangerZoneTab onToast={showToast} />
			</div>
		</div>

		<!-- Bottom padding so last section scrolls fully into view -->
		<div class="h-8"></div>
	</div>
</div>

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
