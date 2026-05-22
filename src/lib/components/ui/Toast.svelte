<script lang="ts">
	let {
		message,
		type = 'success'
	}: {
		message: string;
		type?: 'success' | 'error';
	} = $props();

	let accent = $derived(type === 'success' ? '#16a34a' : '#b00000');
	let bgAccent = $derived(type === 'success' ? '#f0fdf4' : '#fff1f2');
	let icon = $derived(type === 'success' ? '✓' : '✕');
</script>

<div
	style="
		display: flex;
		align-items: center;
		gap: 12px;
		background: #fff;
		border: 1px solid #e0e0e0;
		border-left: 3px solid {accent};
		border-radius: 8px;
		padding: 13px 18px;
		box-shadow: 0 4px 24px rgba(0,0,0,0.09), 0 1px 4px rgba(0,0,0,0.05);
		min-width: 220px;
		max-width: 360px;
		pointer-events: none;
	"
>
	<div
		style="
			width: 22px;
			height: 22px;
			border-radius: 50%;
			background: {bgAccent};
			border: 1.5px solid {accent}33;
			display: flex;
			align-items: center;
			justify-content: center;
			flex-shrink: 0;
		"
	>
		<span style="font-size:11px; font-weight:800; color:{accent}; line-height:1;">{icon}</span>
	</div>
	<span style="font-size:13px; color:#191919; font-weight:500; line-height:1.4;">{message}</span>
</div>
