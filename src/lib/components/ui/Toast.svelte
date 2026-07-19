<script lang="ts">
	let {
		message,
		type = 'success'
	}: {
		message: string;
		type?: 'success' | 'error';
	} = $props();
</script>

<div
	class="pointer-events-none flex max-w-[360px] min-w-[220px] items-center gap-3 rounded-lg border border-border bg-white px-[18px] py-[13px] shadow-[0_4px_24px_rgba(0,0,0,0.09),_0_1px_4px_rgba(0,0,0,0.05)] {type ===
	'error'
		? 'border-l-[3px] border-l-destructive'
		: 'border-l-[3px] border-l-[#16a34a]'}"
>
	<div
		class="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border {type ===
		'error'
			? 'border-[#b0000033] bg-[#fff1f2]'
			: 'border-[#16a34a33] bg-[#f0fdf4]'}"
	>
		<span
			class="text-[11px] leading-none font-extrabold {type === 'error'
				? 'text-destructive'
				: 'text-[#16a34a]'}">{type === 'error' ? '✕' : '✓'}</span
		>
	</div>
	<span class="text-[13px] leading-[1.4] font-medium text-primary">{message}</span>
</div>
