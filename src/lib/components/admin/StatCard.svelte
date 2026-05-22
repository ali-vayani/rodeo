<script lang="ts">
	let { label, value }: { label: string; value: number } = $props();
</script>

<div
	style="background:#fff; border:1px solid #e0e0e0; border-radius:6px; padding:16px 20px; min-width:0;"
>
	<div style="font-size:28px; font-weight:700; color:#191919; line-height:1;">
		{value.toLocaleString()}
	</div>
	<div
		style="font-size:11px; font-weight:600; letter-spacing:0.1em; text-transform:uppercase; color:#aaaaaa; margin-top:6px;"
	>
		{label}
	</div>
</div>
