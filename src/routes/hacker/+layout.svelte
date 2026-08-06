<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import TeamInviteBanner from '$lib/components/account/TeamInviteBanner.svelte';
	import type { LayoutData } from './$types';

	let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();

	const links = [
		{ href: '/hacker/application', label: 'Application' },
		{ href: '/hacker/account', label: 'Account' }
	] as const;
</script>

<div class="flex min-h-screen">
	<!-- Sidebar -->
	<nav class="fixed top-0 left-0 flex h-full w-[210px] flex-col border-r border-border bg-white">
		<div class="px-5 py-5">
			<span class="font-mono text-lg font-medium text-primary">rodeo</span>
		</div>
		<ul class="mt-1 flex flex-1 flex-col gap-0.5 px-3">
			{#each links as link (link.href)}
				<li>
					<a
						href={resolve(link.href)}
						class="block rounded px-3 py-2 text-sm transition-colors {page.url.pathname ===
						link.href
							? 'bg-primary text-white'
							: 'text-primary'}"
					>
						{link.label}
					</a>
				</li>
			{/each}
		</ul>
		<form method="POST" action="/logout" class="border-t border-border p-3">
			<button
				type="submit"
				class="block w-full rounded px-3 py-2 text-left text-sm text-primary transition-colors hover:bg-[#f4f4f4]"
			>
				Log out
			</button>
		</form>
	</nav>

	<!-- Main content -->
	<main class="ml-[210px] min-h-screen flex-1 bg-muted p-8">
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
