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
	class="flex items-center gap-3 bg-white border border-border rounded-lg px-[18px] py-[13px] shadow-[0_4px_24px_rgba(0,0,0,0.09),_0_1px_4px_rgba(0,0,0,0.05)] min-w-[220px] max-w-[360px] pointer-events-none {type === 'error' ? 'border-l-[3px] border-l-destructive' : 'border-l-[3px] border-l-[#16a34a]'}"
>
	<div
		class="w-[22px] h-[22px] rounded-full border flex items-center justify-center shrink-0 {type === 'error' ? 'bg-[#fff1f2] border-[#b0000033]' : 'bg-[#f0fdf4] border-[#16a34a33]'}"
	>
		<span class="text-[11px] font-extrabold leading-none {type === 'error' ? 'text-destructive' : 'text-[#16a34a]'}">{type === 'error' ? '✕' : '✓'}</span>
	</div>
	<span class="text-[13px] text-primary font-medium leading-[1.4]">{message}</span>
</div>
