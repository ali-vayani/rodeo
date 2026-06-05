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
	<div class="text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-2">
		Scan Groups
	</div>
	<p class="text-xs text-muted-foreground mb-4">
		Track check-in points throughout the event (e.g., Check-In, Lunch, Dinner). Changes are saved
		automatically.
	</p>

	<div class="space-y-1.5 mb-4">
		{#each groups as group}
			<div class="flex items-center gap-2">
				<div class="flex-1 text-[13px] text-primary bg-[#f9f9f9] border border-border rounded px-3 py-[7px]">
					{group}
				</div>
				<button
					onclick={() => removeGroup(group)}
					disabled={saving}
					class="text-xs text-muted-foreground hover:text-destructive bg-transparent border-none cursor-pointer px-2 py-1 transition-colors disabled:opacity-40"
				>
					Remove
				</button>
			</div>
		{/each}

		{#if groups.length === 0}
			<div class="text-xs text-muted-foreground py-2 italic">
				No scan groups yet. Add one below.
			</div>
		{/if}
	</div>

	<div class="flex gap-2">
		<input
			type="text"
			bind:value={newGroup}
			onkeydown={handleKeydown}
			placeholder="Group name, or multiple separated by commas…"
			class="flex-1 text-[13px] text-primary bg-white border border-border rounded px-3 py-[7px] outline-none"
		/>
		<button
			onclick={addGroup}
			disabled={saving || !newGroup.trim()}
			class="text-[13px] font-semibold text-white bg-primary border-none rounded-md py-[9px] px-[18px] cursor-pointer disabled:opacity-50"
		>
			Add Group
		</button>
	</div>
</div>
