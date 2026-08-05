<script lang="ts">
	import { page } from '$app/state';
	import { cn } from '$lib/utils';

	let {
		links,
		brand = 'rodeo'
	}: {
		links: { href: string; label: string }[];
		brand?: string;
	} = $props();
</script>

<!--
	routes/admin/+layout.svelte and routes/hacker/+layout.svelte were
	byte-identical except for the links array.
-->
<nav class="fixed top-0 left-0 flex h-full w-sidebar flex-col border-r border-border bg-card">
	<div class="px-5 py-5">
		<span class="font-mono text-lg font-medium text-foreground">{brand}</span>
	</div>

	<ul class="mt-1 flex flex-1 list-none flex-col gap-0.5 px-3 pl-3">
		{#each links as link (link.href)}
			{@const active = page.url.pathname === link.href}
			<li>
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
</nav>
