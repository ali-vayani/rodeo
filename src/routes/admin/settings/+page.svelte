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
<div class="flex items-center justify-between mb-4">
	<h1 class="text-[22px] font-bold text-primary">Settings</h1>
</div>

<!-- Main card: sidebar + scrollable content -->
<div class="flex bg-white border border-border rounded-md overflow-hidden h-[calc(100vh-136px)]">
	<!-- Vertical sidebar (layout 5) -->
	<div class="w-[160px] shrink-0 bg-muted border-r border-border flex flex-col">
		<div
			class="px-3 py-[11px] text-[10px] font-bold tracking-widest text-muted-foreground uppercase border-b border-border"
		>
			Settings
		</div>
		{#each sections as section}
			<button
				onclick={() => scrollToSection(section.id)}
				class="px-4 py-[11px] text-[13px] text-left border-b border-border cursor-pointer transition-colors {activeSection ===
				section.id
					? 'bg-white text-primary font-semibold'
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
		class="flex-1 overflow-y-auto p-8 space-y-5"
	>
		<!-- General section (layout 2 bordered block) -->
		<div id="section-general" class="border border-border rounded-md overflow-hidden">
			<div class="border-b border-border bg-muted px-4 py-[9px]">
				<span class="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">
					General
				</span>
			</div>
			<div class="p-6">
				<GeneralTab timezone={settings.timezone} {saving} onSave={(u) => save(u)} />
			</div>
		</div>

		<!-- Dates section -->
		<div id="section-dates" class="border border-border rounded-md overflow-hidden">
			<div class="border-b border-border bg-muted px-4 py-[9px]">
				<span class="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">
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
		<div id="section-scan-groups" class="border border-border rounded-md overflow-hidden">
			<div class="border-b border-border bg-muted px-4 py-[9px]">
				<span class="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">
					Scan Groups
				</span>
			</div>
			<div class="p-6">
				<ScanGroupsTab scanActions={settings.scanActions} {saving} onSave={(u) => save(u)} />
			</div>
		</div>

		<!-- Danger Zone section -->
		<div id="section-danger" class="border border-[#fca5a5] rounded-md overflow-hidden">
			<div class="border-b border-[#fca5a5] bg-[#fff3f3] px-4 py-[9px]">
				<span class="text-[10px] font-mono tracking-[0.1em] uppercase text-destructive font-medium">
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
		class="fixed bottom-7 right-7 z-[200]"
	>
		<Toast message={toast.message} type={toast.type} />
	</div>
{/if}
