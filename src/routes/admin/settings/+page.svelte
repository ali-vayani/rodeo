<script lang="ts">
	import { errorMessage } from '$lib/ui/errors';
	import { untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { createClient } from '$lib/trpc/client';
	import type { PageData } from './$types';
	import AccountTab from '$lib/components/settings/AccountTab.svelte';
	import GeneralTab from '$lib/components/settings/GeneralTab.svelte';
	import DatesTab from '$lib/components/settings/DatesTab.svelte';
	import ScanGroupsTab from '$lib/components/settings/ScanGroupsTab.svelte';
	import ProjectsTab from '$lib/components/settings/ProjectsTab.svelte';
	import DataExportTab from '$lib/components/settings/DataExportTab.svelte';
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

	let scrollContainer = $state<HTMLElement | undefined>(undefined);
	let activeSection = $state('account');
	const sectionIds = ['account', 'general', 'dates', 'scan-groups', 'projects', 'data', 'danger'];

	const sections = [
		{ id: 'account', label: 'Account' },
		{ id: 'general', label: 'General' },
		{ id: 'dates', label: 'Dates' },
		{ id: 'scan-groups', label: 'Scan Groups' },
		{ id: 'projects', label: 'Projects' },
		{ id: 'data', label: 'Data Export' },
		{ id: 'danger', label: 'Danger Zone' }
	];

	function handleScroll() {
		if (!scrollContainer) return;
		// From md up the sections scroll inside the container, so its top edge is the reading
		// line. Below md the page itself scrolls and the container top goes negative, so clamp
		// the reading line to just below the fixed 48px top bar.
		const containerTop = Math.max(scrollContainer.getBoundingClientRect().top, 48);
		// The last section is shorter than the scroll area, so it can never climb to the
		// reading line on its own.
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
				hackerApplicationOpen: merged.hackerApplicationOpen ?? null,
				hackerApplicationDeadline: merged.hackerApplicationDeadline ?? null,
				mentorApplicationOpen: merged.mentorApplicationOpen ?? null,
				mentorApplicationDeadline: merged.mentorApplicationDeadline ?? null,
				judgeApplicationOpen: merged.judgeApplicationOpen ?? null,
				judgeApplicationDeadline: merged.judgeApplicationDeadline ?? null,
				volunteerApplicationOpen: merged.volunteerApplicationOpen ?? null,
				volunteerApplicationDeadline: merged.volunteerApplicationDeadline ?? null,
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
				walkinTemplate: merged.walkinTemplate,
				walkinSubject: merged.walkinSubject,
				timezone: merged.timezone,
				homeState: merged.homeState,
				projectsEnabled: merged.projectsEnabled,
				projectsUrl: merged.projectsUrl
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

<div class="mb-4 flex items-center justify-between">
	<h1 class="text-[22px] font-bold text-primary">Settings</h1>
</div>

<!-- Below md the vertical Tabs rail flattens into a horizontal strip on top and the
     frame takes its natural height, so the page itself scrolls. -->
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

	<div
		bind:this={scrollContainer}
		onscroll={handleScroll}
		class="min-w-0 flex-1 space-y-5 overflow-y-auto p-4 md:p-8"
	>
		<!-- Account section: who is signed in. First because it answers "am I
		     looking at the right account" before anything below it is edited. -->
		<div
			id="section-account"
			class="scroll-mt-topbar overflow-hidden rounded-md border border-border md:scroll-mt-0"
		>
			<div class="border-b border-border bg-muted px-4 py-[9px]">
				<span class="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
					Account
				</span>
			</div>
			<div class="p-4 md:p-6">
				<AccountTab me={data.me} />
			</div>
		</div>

		<div
			id="section-general"
			class="scroll-mt-topbar overflow-hidden rounded-md border border-border md:scroll-mt-0"
		>
			<div class="border-b border-border bg-muted px-4 py-[9px]">
				<span class="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
					General
				</span>
			</div>
			<div class="p-4 md:p-6">
				<GeneralTab
					timezone={settings.timezone}
					homeState={settings.homeState}
					{saving}
					onSave={(u) => save(u)}
				/>
			</div>
		</div>

		<div
			id="section-dates"
			class="scroll-mt-topbar overflow-hidden rounded-md border border-border md:scroll-mt-0"
		>
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
					hackerApplicationOpen={settings.hackerApplicationOpen}
					hackerApplicationDeadline={settings.hackerApplicationDeadline}
					mentorApplicationOpen={settings.mentorApplicationOpen}
					mentorApplicationDeadline={settings.mentorApplicationDeadline}
					judgeApplicationOpen={settings.judgeApplicationOpen}
					judgeApplicationDeadline={settings.judgeApplicationDeadline}
					volunteerApplicationOpen={settings.volunteerApplicationOpen}
					volunteerApplicationDeadline={settings.volunteerApplicationDeadline}
					{saving}
					onSave={(u) => save(u)}
				/>
			</div>
		</div>

		<div
			id="section-scan-groups"
			class="scroll-mt-topbar overflow-hidden rounded-md border border-border md:scroll-mt-0"
		>
			<div class="border-b border-border bg-muted px-4 py-[9px]">
				<span class="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
					Scan Groups
				</span>
			</div>
			<div class="p-4 md:p-6">
				<ScanGroupsTab scanActions={settings.scanActions} {saving} onSave={(u) => save(u)} />
			</div>
		</div>

		<div
			id="section-projects"
			class="scroll-mt-topbar overflow-hidden rounded-md border border-border md:scroll-mt-0"
		>
			<div class="border-b border-border bg-muted px-4 py-[9px]">
				<span class="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
					Projects
				</span>
			</div>
			<div class="p-4 md:p-6">
				<ProjectsTab
					projectsEnabled={settings.projectsEnabled}
					projectsUrl={settings.projectsUrl}
					{saving}
					onSave={(u) => save(u)}
				/>
			</div>
		</div>

		<!-- Data Export section. Above the danger zone rather than inside it: taking a
				     backup is routine, and the wipe below is what is not. -->
		<div
			id="section-data"
			class="scroll-mt-topbar overflow-hidden rounded-md border border-border md:scroll-mt-0"
		>
			<div class="border-b border-border bg-muted px-4 py-[9px]">
				<span class="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
					Data Export
				</span>
			</div>
			<div class="p-4 md:p-6">
				<DataExportTab onToast={showToast} />
			</div>
		</div>

		<div
			id="section-danger"
			class="scroll-mt-topbar overflow-hidden rounded-md border border-[#fca5a5] md:scroll-mt-0"
		>
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

{#if toast}
	<div
		in:fly={{ x: 60, duration: 280 }}
		out:fly={{ x: 60, duration: 200 }}
		class="fixed right-7 bottom-7 z-[200]"
	>
		<Toast message={toast.message} type={toast.type} />
	</div>
{/if}
