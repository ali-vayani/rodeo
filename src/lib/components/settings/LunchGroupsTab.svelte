<script lang="ts">
	import { createClient } from '$lib/trpc/client';
	import { errorMessage } from '$lib/ui/errors';

	type Group = {
		id: string;
		name: string;
		pool: 'DIETARY_RESTRICTION' | 'NO_RESTRICTION';
		releasedAt: Date | null;
		members: Array<{ user: { uid: string; name: string; team: { teamName: string } | null } }>;
	};

	let {
		initialGroups,
		pools,
		onToast
	}: {
		initialGroups: Group[];
		pools: { dietary: number; noRestriction: number };
		onToast: (message: string, type?: 'success' | 'error') => void;
	} = $props();

	const trpc = createClient();
	let groups = $state<Group[]>(initialGroups);
	let dietaryCount = $state(Math.min(1, pools.dietary));
	let noRestrictionCount = $state(Math.min(1, pools.noRestriction));
	let saving = $state(false);
	let names = $state<Record<string, string>>(
		Object.fromEntries(initialGroups.map((group) => [group.id, group.name]))
	);

	async function refresh() {
		const result = await trpc.lunchGroups.list.query();
		groups = result.groups;
		names = Object.fromEntries(result.groups.map((group) => [group.id, group.name]));
	}

	async function generate() {
		saving = true;
		try {
			const result = await trpc.lunchGroups.generate.mutate({
				dietaryGroupCount: dietaryCount,
				noRestrictionGroupCount: noRestrictionCount
			});
			await refresh();
			onToast(`Generated ${result.count} lunch groups`);
		} catch (error) {
			onToast(errorMessage(error, 'Could not generate lunch groups'), 'error');
		} finally {
			saving = false;
		}
	}

	async function rename(group: Group) {
		const name = names[group.id]?.trim();
		if (!name || name === group.name) return;
		saving = true;
		try {
			await trpc.lunchGroups.rename.mutate({ id: group.id, name });
			await refresh();
			onToast('Lunch group renamed');
		} catch (error) {
			onToast(errorMessage(error, 'Could not rename lunch group'), 'error');
		} finally {
			saving = false;
		}
	}

	async function release() {
		saving = true;
		try {
			const result = await trpc.lunchGroups.release.mutate();
			await refresh();
			onToast(
				result.count
					? `Released ${result.count} lunch groups to attendees`
					: 'Lunch groups are already released'
			);
		} catch (error) {
			onToast(errorMessage(error, 'Could not release lunch groups'), 'error');
		} finally {
			saving = false;
		}
	}

	let hasUnreleasedGroups = $derived(groups.some((group) => group.releasedAt === null));
</script>

<div class="max-w-[720px] space-y-5">
	<p class="text-xs text-muted-foreground">
		Confirmed and checked-in attendees are separated by whether they answered a Dietary restriction
		linked-field question. Teams stay together whenever possible.
	</p>

	<div class="grid gap-3 sm:grid-cols-2">
		<label class="space-y-1.5 text-xs font-semibold text-primary">
			Dietary restriction groups <span class="font-normal text-muted-foreground"
				>({pools.dietary} attendees)</span
			>
			<input
				type="number"
				min="0"
				max="50"
				bind:value={dietaryCount}
				class="block w-full rounded border border-border px-3 py-2 text-sm font-normal"
			/>
		</label>
		<label class="space-y-1.5 text-xs font-semibold text-primary">
			No-restriction groups <span class="font-normal text-muted-foreground"
				>({pools.noRestriction} attendees)</span
			>
			<input
				type="number"
				min="0"
				max="50"
				bind:value={noRestrictionCount}
				class="block w-full rounded border border-border px-3 py-2 text-sm font-normal"
			/>
		</label>
	</div>

	<button
		onclick={generate}
		disabled={saving}
		class="cursor-pointer rounded-md border-none bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
	>
		Generate lunch groups
	</button>
	{#if groups.length}
		<button
			onclick={release}
			disabled={saving || !hasUnreleasedGroups}
			class="ml-2 cursor-pointer rounded-md border border-primary bg-white px-4 py-2 text-sm font-semibold text-primary disabled:opacity-50"
		>
			{hasUnreleasedGroups ? 'Release to attendees' : 'Released to attendees'}
		</button>
	{/if}

	{#if groups.length}
		<div class="space-y-3 border-t border-border pt-5">
			{#each groups as group (group.id)}
				<div class="rounded border border-border p-3">
					<div class="flex flex-wrap items-center gap-2">
						<input
							bind:value={names[group.id]}
							aria-label="Lunch group name"
							class="min-w-[180px] flex-1 rounded border border-border px-2 py-1.5 text-sm"
						/>
						<span class="text-xs text-muted-foreground">{group.members.length} attendees</span>
						<button
							onclick={() => rename(group)}
							disabled={saving}
							class="cursor-pointer bg-transparent text-xs font-semibold text-primary disabled:opacity-50"
							>Save name</button
						>
					</div>
					<p class="mt-2 text-xs text-muted-foreground">
						{group.members.map((member) => member.user.name).join(', ') || 'No attendees assigned'}
					</p>
				</div>
			{/each}
		</div>
	{:else}
		<p class="text-xs text-muted-foreground italic">No lunch groups have been generated yet.</p>
	{/if}
</div>
