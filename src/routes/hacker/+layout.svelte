<script lang="ts">
	import { resolve } from '$app/paths';
	import TeamInviteBanner from '$lib/components/account/TeamInviteBanner.svelte';
	import HackerRail from '$lib/components/hacker/HackerRail.svelte';
	import type { LayoutData } from './$types';

	let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();

	// resolve() here keeps the href literals typechecked against real routes. The
	// Walk-In tab exists only for invited accounts; its page redirects everyone else.
	const links = $derived([
		{ href: resolve('/hacker'), label: 'Home' },
		{ href: resolve('/hacker/application'), label: 'Application' },
		...(data.user.walkInInvitedAt ? [{ href: resolve('/hacker/walkin'), label: 'Walk-In' }] : []),
		{ href: resolve('/hacker/account'), label: 'Account' }
	]);
</script>

<!--
	`bg-card` on the wrapper, not decoration: the rail is `fixed`, so it is only ever
	one viewport tall. On a page that scrolls past that, the strip beneath it would
	otherwise fall through to the body's gray and leave the white column looking cut off.
-->
<div class="flex min-h-screen bg-card font-display">
	<HackerRail {links} />

	<!--
		The brand canvas. It lives on <main> rather than on <body> so the admin
		console, which shares the same stylesheet, keeps its flat gray page.
	-->
	<main
		class="mt-topbar min-h-screen min-w-0 flex-1 brand-canvas p-4 md:mt-0 md:ml-rail md:px-11 md:py-10"
	>
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
