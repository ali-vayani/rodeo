<script lang="ts">
	import { resolve } from '$app/paths';
	import BatLogo from '$lib/components/brand/BatLogo.svelte';
	import BracketFrame from '$lib/components/brand/BracketFrame.svelte';
</script>

<!--
	The front door. Gradient canvas, one white card, one action — the same shape the
	hacker portal uses behind the login, so signing in doesn't feel like a scene change.
-->
<div class="flex min-h-screen items-center justify-center brand-canvas p-6 font-display">
	<div class="relative w-full max-w-modal-md bg-card px-11 py-11 text-center shadow-panel">
		<BracketFrame class="inset-4 text-brand-ink" arm="size-5" />
		<div class="mb-4 flex items-center justify-center gap-4">
			<BatLogo class="w-23 text-brand-ink" />
			<span class="text-display font-extrabold tracking-wide text-brand-ink">RODEO</span>
		</div>

		<p class="mb-7 text-md leading-relaxed text-foreground-secondary">
			Freetail's premier hackathon management platform.
		</p>

		<a
			href={resolve('/login')}
			class="block w-full bg-brand-ink px-6 py-3 text-md font-semibold text-white
			 no-underline transition-colors duration-150 hover:bg-primary-hover
			 focus-visible:shadow-ring"
		>
			Begin →
		</a>
	</div>
</div>
