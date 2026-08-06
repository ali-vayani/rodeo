<script lang="ts">
	import { errorMessage } from '$lib/ui/errors';
	import { untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { createClient } from '$lib/trpc/client';
	import type { PageData } from './$types';
	import GeneralTab from '$lib/components/settings/GeneralTab.svelte';
	import DatesTab from '$lib/components/settings/DatesTab.svelte';
	import ScanGroupsTab from '$lib/components/settings/ScanGroupsTab.svelte';
	import DangerZoneTab from '$lib/components/settings/DangerZoneTab.svelte';
	import Toast from '$lib/components/legacy/Toast.svelte';
	import { Tabs } from '$lib/components/patterns';

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
		// From md up the sections scroll inside the container, so its top edge is
		// the reading line. Below md the frame is auto-height and the page itself
		// scrolls, so the container top goes negative — clamp the reading line to
		// just below the fixed 48px top bar instead.
		const containerTop = Math.max(scrollContainer.getBoundingClientRect().top, 48);
		// The last section is shorter than the scroll area, so it can never climb
		// to the reading line on its own — snap to it once scrolled to the end.
		const atContainerBottom =
			scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - 2;
		const atPageBottom =
			window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
		if (atContainerBottom && atPageBottom) {
			activeSection = sectionIds[sectionIds.length - 1];
			return;
		}
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
		} catch (e) {
			showToast(errorMessage(e, 'Failed to save settings'), 'error');
		} finally {
			saving = false;
		}
	}
</script>

<!-- Below md the page (not the container) scrolls, so the spy listens there too. -->
<svelte:window onscroll={handleScroll} />

<!-- Page header -->
<div class="mb-4 flex items-center justify-between">
	<h1 class="text-[22px] font-bold text-primary">Settings</h1>
</div>

<!-- Main card: sidebar + scrollable content. Below md the vertical Tabs rail
     flattens into a horizontal strip on top and the frame takes its natural
     height (workspace-h is auto below md), so the page itself scrolls. -->
<div
	class="flex workspace-h flex-col overflow-hidden rounded-md border border-border bg-white md:flex-row"
>
	<!-- Section rail (scroll-spy over the shared Tabs vertical variant) -->
	<Tabs
		orientation="vertical"
		tabs={sections.map((s) => ({ value: s.id, label: s.label }))}
		bind:active={activeSection}
		onChange={scrollToSection}
	/>

	<!-- Scrollable content area -->
	<div
		bind:this={scrollContainer}
		onscroll={handleScroll}
		class="min-w-0 flex-1 space-y-5 overflow-y-auto p-4 md:p-8"
	>
		<!-- General section (layout 2 bordered block) -->
		<div id="section-general" class="scroll-mt-topbar md:scroll-mt-0 overflow-hidden rounded-md border border-border">
			<div class="border-b border-border bg-muted px-4 py-[9px]">
				<span class="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
					General
				</span>
			</div>
			<div class="p-4 md:p-6">
				<GeneralTab timezone={settings.timezone} {saving} onSave={(u) => save(u)} />
			</div>
		</div>

		<!-- Dates section -->
		<div id="section-dates" class="scroll-mt-topbar md:scroll-mt-0 overflow-hidden rounded-md border border-border">
			<div class="border-b border-border bg-muted px-4 py-[9px]">
				<span class="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
					Dates
				</span>
			</div>
			<div class="p-4 md:p-6">
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
		<div id="section-scan-groups" class="scroll-mt-topbar md:scroll-mt-0 overflow-hidden rounded-md border border-border">
			<div class="border-b border-border bg-muted px-4 py-[9px]">
				<span class="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
					Scan Groups
				</span>
			</div>
			<div class="p-4 md:p-6">
				<ScanGroupsTab scanActions={settings.scanActions} {saving} onSave={(u) => save(u)} />
			</div>
		</div>

		<!-- Danger Zone section -->
		<div id="section-danger" class="scroll-mt-topbar md:scroll-mt-0 overflow-hidden rounded-md border border-[#fca5a5]">
			<div class="border-b border-[#fca5a5] bg-[#fff3f3] px-4 py-[9px]">
				<span class="font-mono text-[10px] font-medium tracking-[0.1em] text-destructive uppercase">
					Danger Zone
				</span>
			</div>
			<div class="p-4 md:p-6">
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
