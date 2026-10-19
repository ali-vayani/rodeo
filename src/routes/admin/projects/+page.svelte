<script lang="ts">
	import { resolve } from '$app/paths';
	import { Search } from 'lucide-svelte';
	import { Badge, Card, EmptyState, Input } from '$lib/components/ui';
	import { PageHeader } from '$lib/components/patterns';
	import { filterProjects } from '$lib/projects/filter';
	import { pluralize } from '$lib/format';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let query = $state('');
	const shown = $derived(filterProjects(data.projects, query));
</script>

<PageHeader title="Projects">
	{#snippet description()}
		{#if data.projectsEnabled}
			Hackers can see this list on their Projects tab.
		{:else}
			Hidden from hackers. Turn it on under
			<a href={resolve('/admin/settings')} class="text-primary underline">Settings</a>.
		{/if}
	{/snippet}
	{#snippet meta()}
		{pluralize(data.projects.length, 'project')}
	{/snippet}
</PageHeader>

<Card padding="none">
	{#snippet header()}
		<div class="relative w-full max-w-sm">
			<Search
				class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-foreground-tertiary"
			/>
			<Input
				type="search"
				bind:value={query}
				placeholder="Search by name, keyword, or table"
				aria-label="Search projects"
				class="pl-8"
			/>
		</div>
	{/snippet}

	{#if data.error}
		<EmptyState title="Feed unavailable" message={data.error} />
	{:else if !shown.length}
		<EmptyState message={query ? `Nothing matches "${query}".` : 'The feed has no projects yet.'} />
	{:else}
		<ul class="m-0 list-none divide-y divide-border p-0">
			{#each shown as project (`${project.table}-${project.name}`)}
				<li class="grid gap-x-5 gap-y-1 px-5 py-4 sm:grid-cols-[6rem_1fr]">
					<div><Badge>Table {project.table}</Badge></div>
					<div class="min-w-0">
						<h2 class="m-0 text-lg font-semibold text-foreground">{project.name}</h2>
						{#if project.description}
							<p class="mt-1 mb-0 text-base text-foreground-secondary">{project.description}</p>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</Card>
