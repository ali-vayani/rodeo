<script lang="ts">
	import { page } from '$app/state';
	import { afterNavigate } from '$app/navigation';
	import { fade, fly } from 'svelte/transition';
	import { Menu, X } from 'lucide-svelte';
	import { cn } from '$lib/utils';
	import IconButton from '$lib/components/ui/IconButton.svelte';

	let {
		links,
		brand = 'rodeo'
	}: {
		links: { href: string; label: string }[];
		brand?: string;
	} = $props();

	let drawerOpen = $state(false);
	let drawerEl = $state<HTMLElement | null>(null);

	// A tap on a link should both navigate and put the drawer away.
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

<!--
	Below md this is a fixed top bar whose hamburger opens the same nav as an overlay
	drawer; from md up it is a left rail.
-->

{#snippet navContent(inDrawer: boolean)}
	<div class="flex items-center justify-between px-5 py-5">
		<span class="font-mono text-lg font-medium text-foreground">{brand}</span>
		{#if inDrawer}
			<IconButton label="Close menu" onclick={() => (drawerOpen = false)}>
				<X class="size-4" />
			</IconButton>
		{/if}
	</div>

	<ul class="mt-1 flex flex-1 list-none flex-col gap-0.5 px-3 pl-3">
		{#each links as link (link.href)}
			{@const active = page.url.pathname === link.href}
			<li>
				<!--
					Links come from the layout that mounts this, which is where the
					routes are actually known. Same tradeoff as Button's href.
				-->
				<!-- eslint-disable svelte/no-navigation-without-resolve -->
				<a
					href={link.href}
					aria-current={active ? 'page' : undefined}
					class={cn(
						'block rounded-md px-3 py-2 text-base no-underline transition-colors duration-150',
						'focus-visible:shadow-ring',
						active
							? 'bg-primary font-medium text-primary-foreground'
							: 'text-foreground hover:bg-muted'
					)}
				>
					{link.label}
				</a>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			</li>
		{/each}
	</ul>

	<form method="POST" action="/logout" class="border-t border-border p-3">
		<button
			type="submit"
			class="block w-full cursor-pointer rounded-md border-none bg-transparent px-3 py-2 text-left
			       text-base text-foreground transition-colors duration-150 hover:bg-muted
			       focus-visible:shadow-ring"
		>
			Log out
		</button>
	</form>
{/snippet}

<!-- Mobile top bar -->
<header
	class="fixed inset-x-0 top-0 z-30 flex h-topbar items-center gap-2 border-b border-border
	       bg-card px-3 md:hidden"
>
	<IconButton label="Open menu" aria-expanded={drawerOpen} onclick={() => (drawerOpen = true)}>
		<Menu class="size-5" />
	</IconButton>
	<span class="font-mono text-lg font-medium text-foreground">{brand}</span>
</header>

<!-- Desktop rail -->
<nav
	aria-label="Main"
	class="fixed top-0 left-0 z-30 hidden h-full w-sidebar flex-col border-r border-border
	       bg-card md:flex"
>
	{@render navContent(false)}
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
		class="fixed top-0 left-0 z-50 flex h-full w-sidebar flex-col border-r border-border
		       bg-card outline-none md:hidden"
		transition:fly={{ x: -210, duration: 200 }}
	>
		{@render navContent(true)}
	</nav>
{/if}
