<script lang="ts">
	import { untrack } from 'svelte';
	import NameEditor from '$lib/components/account/NameEditor.svelte';
	import { Badge } from '$lib/components/ui';
	import { formatDate, humanizeEnum, initials } from '$lib/format';

	let {
		me
	}: {
		/** null only if the session vanished between the hook and the load. */
		me: { name: string; email: string; role: string; createdAt: Date | string } | null;
	} = $props();
	let name = $state(untrack(() => me?.name ?? ''));
</script>

<div class="max-w-[560px]">
	{#if !me}
		<p class="m-0 text-[13px] text-muted-foreground italic">Not signed in.</p>
	{:else}
		<div class="flex items-center gap-4">
			<div
				class="flex size-12 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-md font-medium text-foreground-secondary"
				aria-hidden="true"
			>
				{initials(name)}
			</div>
			<div class="min-w-0 flex-1">
				<NameEditor bind:name email={me.email} nameClass="text-md font-semibold text-primary" />
			</div>
		</div>

		<div class="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
			<div>
				<div class="mb-1.5 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
					Role
				</div>
				<Badge tone="info">{humanizeEnum(me.role)}</Badge>
			</div>
			<div>
				<div class="mb-1.5 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
					Member since
				</div>
				<div class="font-mono text-[13px] text-[#333]">{formatDate(me.createdAt)}</div>
			</div>
		</div>
	{/if}
</div>
