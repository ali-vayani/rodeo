<script lang="ts">
	let { label, value }: { label: string; value: number } = $props();
</script>

<div class="min-w-0 rounded-md border border-border bg-white px-5 py-4">
	<div class="text-[28px] font-bold leading-none text-primary">
		{value.toLocaleString()}
	</div>
	<div class="mt-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
		{label}
	</div>
</div>
