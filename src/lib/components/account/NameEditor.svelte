<script lang="ts">
	import { untrack } from 'svelte';
	import { createClient } from '$lib/trpc/client';
	import { Button, Input } from '$lib/components/ui';
	import { toast } from '$lib/ui/toast.svelte';

	let {
		name = $bindable(),
		email,
		nameClass = 'text-2xl leading-tight font-extrabold text-foreground'
	}: { name: string; email: string; nameClass?: string } = $props();

	const id = $props.id();
	const trpc = createClient();
	let draft = $state(untrack(() => name));
	let editing = $state(false);
	let saving = $state(false);
	let trimmedName = $derived(draft.trim());
	let canSave = $derived(
		trimmedName.length > 0 && trimmedName.length <= 100 && trimmedName !== name
	);

	async function saveName(event: SubmitEvent) {
		event.preventDefault();
		if (!canSave || saving) return;
		saving = true;
		try {
			const updated = await trpc.user.updateName.mutate({ name: trimmedName });
			name = updated.name;
			draft = updated.name;
			editing = false;
			toast.success('Name updated');
		} catch (error) {
			toast.fromError(error, 'Failed to update name');
		} finally {
			saving = false;
		}
	}
</script>

<div class="flex flex-wrap items-center gap-3">
	<p class="min-w-0 break-words {nameClass}">{name}</p>
	<button
		type="button"
		class="shrink-0 cursor-pointer text-sm font-medium text-brand-purple hover:underline focus-visible:shadow-ring"
		aria-expanded={editing}
		aria-controls={`${id}-form`}
		onclick={() => {
			if (!editing) draft = name;
			editing = true;
		}}
	>
		Edit Name
	</button>
</div>
<p class="mt-1 text-base break-words text-foreground-secondary">{email}</p>

{#if editing}
	<form id={`${id}-form`} class="mt-5 flex items-end gap-3" onsubmit={saveName}>
		<Input
			bind:value={draft}
			label="Display name"
			required
			maxlength={100}
			autocomplete="name"
			fieldClass="min-w-0 flex-1"
		/>
		<Button type="submit" variant="primary" loading={saving} disabled={!canSave}>Save</Button>
	</form>
{/if}
