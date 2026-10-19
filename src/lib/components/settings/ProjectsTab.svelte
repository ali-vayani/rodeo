<script lang="ts">
	import { untrack } from 'svelte';
	import { Input, Switch } from '$lib/components/ui';

	let {
		projectsEnabled,
		projectsUrl,
		saving,
		onSave
	}: {
		projectsEnabled: boolean;
		projectsUrl: string | null;
		saving: boolean;
		onSave: (updates: { projectsEnabled: boolean; projectsUrl: string | null }) => void;
	} = $props();

	let localEnabled = $state(untrack(() => projectsEnabled));
	let localUrl = $state(untrack(() => projectsUrl ?? ''));
</script>

<div class="max-w-[560px]">
	<div class="mb-5">
		<div class="mb-1.5 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
			Projects Tab
		</div>
		<div class="mb-3 text-xs text-muted-foreground">
			Adds a Projects tab to the hacker portal listing every submitted project and its table. Staff
			can always see the list under Projects; this only controls whether hackers can.
		</div>
		<Switch bind:checked={localEnabled} label="Show the Projects tab to hackers" />
	</div>

	<div class="mb-5">
		<div class="mb-1.5 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
			Projects Feed URL
		</div>
		<div class="mb-2 text-xs text-muted-foreground">
			A JSON array of <code>{'{ name, table, description }'}</code> objects. Fetched on the server each
			time the page loads.
		</div>
		<Input
			type="url"
			bind:value={localUrl}
			placeholder="https://example.com/projects.json"
			aria-label="Projects feed URL"
			mono
		/>
	</div>

	<button
		onclick={() => onSave({ projectsEnabled: localEnabled, projectsUrl: localUrl.trim() || null })}
		disabled={saving}
		class="cursor-pointer rounded-md border-none bg-primary px-[18px] py-[9px] text-[13px] font-semibold text-white disabled:opacity-50"
	>
		{saving ? 'Saving…' : 'Save Changes'}
	</button>
</div>
