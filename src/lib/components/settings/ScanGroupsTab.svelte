<script lang="ts">
	import { untrack } from 'svelte';

	let {
		scanActions,
		saving,
		onSave
	}: {
		scanActions: string[];
		saving: boolean;
		onSave: (updates: { scanActions: string[] }) => void;
	} = $props();

	let groups = $state<string[]>(untrack(() => [...scanActions]));
	let newGroup = $state('');

	function addGroup() {
		const names = newGroup
			.split(',')
			.map((s) => s.trim())
			.filter((s) => s && !groups.includes(s));
		if (!names.length) return;
		groups = [...groups, ...names];
		newGroup = '';
		onSave({ scanActions: groups });
	}

	function removeGroup(group: string) {
		groups = groups.filter((g) => g !== group);
		onSave({ scanActions: groups });
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') addGroup();
	}
</script>

<div class="max-w-[560px]">
	<div class="mb-2 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
		Scan Groups
	</div>
	<p class="mb-4 text-xs text-muted-foreground">
		Track check-in points throughout the event (e.g., Check-In, Lunch, Dinner). Changes are saved
		automatically.
	</p>

	<div class="mb-4 space-y-1.5">
		{#each groups as group (group)}
			<div class="flex items-center gap-2">
				<div
					class="flex-1 rounded border border-border bg-[#f9f9f9] px-3 py-[7px] text-[13px] text-primary"
				>
					{group}
				</div>
				<button
					onclick={() => removeGroup(group)}
					disabled={saving}
					class="cursor-pointer border-none bg-transparent px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-destructive disabled:opacity-40"
				>
					Remove
				</button>
			</div>
		{/each}

		{#if groups.length === 0}
			<div class="py-2 text-xs text-muted-foreground italic">
				No scan groups yet. Add one below.
			</div>
		{/if}
	</div>

	<!-- flex-wrap + min-w on the input: on a 320px screen the button drops to
	     its own row instead of crushing the input (or being crushed itself). -->
	<div class="flex flex-wrap gap-2">
		<input
			type="text"
			bind:value={newGroup}
			onkeydown={handleKeydown}
			placeholder="Group name, or multiple separated by commas…"
			class="min-w-[180px] flex-1 rounded border border-border bg-white px-3 py-[7px] text-[13px] text-primary outline-none"
		/>
		<button
			onclick={addGroup}
			disabled={saving || !newGroup.trim()}
			class="cursor-pointer rounded-md border-none bg-primary px-[18px] py-[9px] text-[13px] font-semibold whitespace-nowrap text-white disabled:opacity-50"
		>
			Add Group
		</button>
	</div>
</div>
