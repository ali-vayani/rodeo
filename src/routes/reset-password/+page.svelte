<script lang="ts">
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
</script>

<div class="flex min-h-screen items-center justify-center bg-white px-6">
	<div class="w-full max-w-sm">
		<div class="mb-8 text-center">
			<p class="font-mono text-xs tracking-widest text-muted-foreground uppercase">
				Hackathon Management
			</p>
			<h1 class="mt-1 font-mono text-3xl font-bold tracking-widest text-primary uppercase">
				RODEO
			</h1>
			<p class="mt-2 text-sm text-muted-foreground">Choose a new password</p>
		</div>

		<form method="POST" class="flex flex-col gap-3">
			<input
				type="password"
				name="password"
				placeholder="New password"
				required
				autocomplete="new-password"
				class="w-full rounded border border-border px-3 py-2 text-sm outline-none focus:border-primary"
			/>

			<input
				type="password"
				name="confirm"
				placeholder="Confirm new password"
				required
				autocomplete="new-password"
				class="w-full rounded border border-border px-3 py-2 text-sm outline-none focus:border-primary"
			/>

			{#if form?.error}
				<p class="text-sm text-destructive">{form.error}</p>
			{/if}

			<button
				type="submit"
				class="w-full rounded bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-85"
			>
				Set new password →
			</button>
		</form>

		<p class="mt-8 text-center font-mono text-xs text-muted-foreground">
			RODEO · Hackathon Management Platform
		</p>
	</div>
</div>
