<script lang="ts">
	import type { ActionData } from './$types';
	import BatLogo from '$lib/components/brand/BatLogo.svelte';
	import BracketFrame from '$lib/components/brand/BracketFrame.svelte';

	let { form }: { form: ActionData } = $props();
</script>

<div class="flex min-h-screen items-center justify-center brand-canvas p-6 font-display">
	<div class="relative w-full max-w-modal-md bg-card px-11 py-11 shadow-panel">
		<BracketFrame class="inset-4 text-brand-ink" arm="size-5" />
		<div class="mb-7 text-center">
			<BatLogo class="mx-auto mb-2 w-21 text-brand-ink" />
			<h1 class="text-3xl font-extrabold tracking-wide text-brand-ink">RODEO</h1>
			<p class="mt-2 text-md text-foreground-secondary">Choose a new password</p>
		</div>

		<form method="POST" class="flex flex-col gap-4">
			<input
				type="password"
				name="password"
				placeholder="New password"
				required
				autocomplete="new-password"
				class="w-full border border-border bg-card px-3.5 py-2.5 text-md text-foreground
				 transition-colors duration-150 outline-none focus:border-brand-purple
				 focus-visible:shadow-ring"
			/>

			<input
				type="password"
				name="confirm"
				placeholder="Confirm new password"
				required
				autocomplete="new-password"
				class="w-full border border-border bg-card px-3.5 py-2.5 text-md text-foreground
				 transition-colors duration-150 outline-none focus:border-brand-purple
				 focus-visible:shadow-ring"
			/>

			{#if form?.error}
				<p class="text-base text-destructive" role="alert">{form.error}</p>
			{/if}

			<button
				type="submit"
				class="w-full cursor-pointer bg-brand-ink px-4 py-3 font-display text-md
				 font-semibold text-white transition-colors duration-150 hover:bg-primary-hover
				 focus-visible:shadow-ring"
			>
				Set new password →
			</button>
		</form>

		<p
			class="mt-8 text-center font-mono text-2xs tracking-eyebrow text-foreground-tertiary uppercase"
		>
			Freetail Hackers
		</p>
	</div>
</div>
