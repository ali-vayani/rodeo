<script lang="ts">
	import { resolve } from '$app/paths';
	import TeamInviteBanner from '$lib/components/account/TeamInviteBanner.svelte';
	import SidebarNav from '$lib/components/patterns/SidebarNav.svelte';
	import type { LayoutData } from './$types';

	let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();

	// resolve() here keeps the href literals typechecked against real routes.
	const links = [
		{ href: resolve('/hacker/application'), label: 'Application' },
		{ href: resolve('/hacker/account'), label: 'Account' }
	];
</script>

<div class="flex min-h-screen">
	<SidebarNav {links} />

	<!-- Main content -->
	<main class="mt-topbar min-h-screen min-w-0 flex-1 bg-muted p-4 md:mt-0 md:ml-sidebar md:p-8">
		<!--
			Above the page, and keyed on the code so switching to a different invitation
			resets the component's dismissed/joined flags rather than carrying them over.
		-->
		{#if data.invite}
			{#key data.invite.inviteCode}
				<TeamInviteBanner invite={data.invite} />
			{/key}
		{/if}
		{@render children()}
	</main>
</div>
