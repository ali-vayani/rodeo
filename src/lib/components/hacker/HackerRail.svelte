<script lang="ts">
	import { page } from '$app/state';
	import { afterNavigate } from '$app/navigation';
	import { fade, fly } from 'svelte/transition';
	import { Menu, X } from 'lucide-svelte';
	import { cn } from '$lib/utils';
	import IconButton from '$lib/components/ui/IconButton.svelte';
	import BatLogo from '$lib/components/brand/BatLogo.svelte';
	import BracketFrame from '$lib/components/brand/BracketFrame.svelte';

	/**
	 * The hacker portal's left rail.
	 *
	 * Deliberately not `SidebarNav`, which the admin console also mounts: this one is
	 * branded (bat lockup, bracket corners, full-bleed active row) and the admin's
	 * monochrome rail is not supposed to follow it. The drawer mechanics below are the
	 * same shape as SidebarNav's because they solve the same problem — it is a small
	 * amount of duplication in exchange for the two rails being able to diverge.
	 */
	let { links }: { links: { href: string; label: string }[] } = $props();

	let drawerOpen = $state(false);
	let drawerEl = $state<HTMLElement | null>(null);

	afterNavigate(() => (drawerOpen = false));

	$effect(() => {
		if (drawerOpen) {
			drawerEl?.focus();
			document.body.style.overflow = 'hidden';
			return () => {
				document.body.style.overflow = '';
			};
		}
	});
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.key === 'Escape') drawerOpen = false;
	}}
/>

{#snippet railContent(inDrawer: boolean)}
	<!--
		Drawn over the rail rather than as its border, so the active nav row can still
		run edge to edge behind the brackets. Desktop only — at drawer width they read
		as clutter.
	-->
	{#if !inDrawer}
		<BracketFrame class="inset-4 text-brand-ink" arm="size-6" />
	{/if}

	<div
		class={cn(
			'border-b border-brand-line px-6',
			inDrawer ? 'flex items-center justify-between py-4' : 'pt-10 pb-6 text-center'
		)}
	>
		<!-- Already resolved by the layout that mounts this, same as the nav links below. -->
		<!-- eslint-disable svelte/no-navigation-without-resolve -->
		<a
			href={links[0]?.href ?? '/'}
			class={cn(
				'no-underline focus-visible:shadow-ring',
				inDrawer ? 'flex items-center gap-3' : 'block'
			)}
		>
			<BatLogo class={cn('text-brand-ink', inDrawer ? 'w-9' : 'mx-auto mb-2 w-18')} />
			<span
				class={cn(
					'font-display font-extrabold tracking-wider text-brand-ink',
					inDrawer ? 'text-lg' : 'block text-xl'
				)}
			>
				RODEO
			</span>
		</a>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
		{#if inDrawer}
			<IconButton label="Close menu" onclick={() => (drawerOpen = false)}>
				<X class="size-4" />
			</IconButton>
		{/if}
	</div>

	<ul class="flex list-none flex-col p-0">
		{#each links as link (link.href)}
			{@const active = page.url.pathname === link.href}
			<li>
				<!--
					Links come from the layout that mounts this, which is where the routes
					are actually known. Same tradeoff as SidebarNav.
				-->
				<!-- eslint-disable svelte/no-navigation-without-resolve -->
				<a
					href={link.href}
					aria-current={active ? 'page' : undefined}
					class={cn(
						'block border-b border-brand-line px-6 py-4 font-display text-md no-underline',
						'transition-colors duration-150 focus-visible:shadow-ring',
						active
							? 'bg-brand-purple font-semibold text-white'
							: 'text-brand-ink hover:bg-brand-well'
					)}
				>
					{link.label}
				</a>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			</li>
		{/each}
	</ul>

	<form method="POST" action="/logout" class="mt-auto px-6 pt-6 pb-8">
		<button
			type="submit"
			class="w-full cursor-pointer border border-brand-ink bg-transparent px-4 py-2
			 font-display text-base text-brand-ink transition-colors duration-150
			 hover:bg-brand-ink hover:text-white focus-visible:shadow-ring"
		>
			Log out
		</button>
	</form>
{/snippet}

<!-- Mobile top bar -->
<header
	class="fixed inset-x-0 top-0 z-30 flex h-topbar items-center gap-2 border-b border-brand-line
	 bg-card px-3 md:hidden"
>
	<IconButton label="Open menu" aria-expanded={drawerOpen} onclick={() => (drawerOpen = true)}>
		<Menu class="size-5" />
	</IconButton>
	<BatLogo class="w-7 text-brand-ink" />
	<span class="font-display text-lg font-extrabold tracking-wider text-brand-ink">RODEO</span>
</header>

<!-- Desktop rail -->
<nav
	aria-label="Main"
	class="fixed top-0 left-0 z-30 hidden h-full w-rail flex-col bg-card md:flex"
>
	{@render railContent(false)}
</nav>

<!-- Mobile drawer -->
{#if drawerOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-40 bg-overlay md:hidden"
		transition:fade={{ duration: 150 }}
		onclick={() => (drawerOpen = false)}
	></div>
	<nav
		bind:this={drawerEl}
		tabindex="-1"
		aria-label="Main"
		class="fixed top-0 left-0 z-50 flex h-full w-rail flex-col bg-card outline-none md:hidden"
		transition:fly={{ x: -232, duration: 200 }}
	>
		{@render railContent(true)}
	</nav>
{/if}
