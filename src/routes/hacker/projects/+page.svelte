<script lang="ts">
	import { Search } from 'lucide-svelte';
	import BracketFrame from '$lib/components/brand/BracketFrame.svelte';
	import { filterProjects } from '$lib/projects/filter';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let query = $state('');
	const shown = $derived(filterProjects(data.projects, query));
</script>

<header class="mb-6">
	<h1 class="font-display text-display font-extrabold tracking-wide text-white uppercase">
		Projects
	</h1>
	<p class="mt-1 text-md text-white/80">Every team's submission and the table to find it at.</p>
</header>

<!--
	Same card-with-brackets frame as the home page, so the two tabs read as one portal.
	The search sits in the card's header strip rather than above it: the list is the
	subject, and the box is a control on it.
-->
<div class="relative bg-card shadow-float">
	<BracketFrame class="inset-3.5 text-brand-ink" arm="size-5" />

	<div
		class="flex flex-wrap items-center justify-between gap-4 border-b border-brand-line px-6 py-5 md:px-10"
	>
		<span class="font-mono text-2xs tracking-eyebrow text-foreground-tertiary uppercase">
			{data.projects.length} projects
		</span>
		{#if data.projects.length}
			<label class="relative block w-full sm:w-72">
				<span class="sr-only">Search projects</span>
				<Search
					class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-tertiary"
				/>
				<input
					type="search"
					bind:value={query}
					placeholder="Name, keyword, or table number"
					class="w-full border border-brand-line bg-brand-well py-2 pr-3 pl-9 font-display text-md text-brand-ink
					 placeholder:text-foreground-tertiary focus:border-brand-purple focus:outline-none"
				/>
			</label>
		{/if}
	</div>

	<div class="p-6 md:p-10">
		{#if data.error}
			<p class="m-0 text-md text-foreground-secondary">{data.error}</p>
		{:else if !shown.length}
			<p class="m-0 text-md text-foreground-secondary">
				{query ? `Nothing matches "${query}".` : 'No projects have been submitted yet.'}
			</p>
		{:else}
			<ul class="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3">
				{#each shown as project (`${project.table}-${project.name}`)}
					<li class="flex flex-col gap-3 border border-brand-line bg-brand-well p-5">
						<!--
							The table number leads: at the expo you are looking for a place, and the name
							confirms you found it. Display face for the number, same as the status card.
						-->
						<div class="flex items-baseline justify-between gap-3 border-b border-brand-line pb-3">
							<span class="font-mono text-2xs tracking-eyebrow text-foreground-tertiary uppercase">
								Table
							</span>
							<span class="font-display text-xl font-bold text-brand-purple">{project.table}</span>
						</div>
						<h2 class="m-0 font-display text-lg font-bold text-brand-ink">{project.name}</h2>
						{#if project.description}
							<p class="m-0 text-md leading-relaxed text-foreground-secondary">
								{project.description}
							</p>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>
