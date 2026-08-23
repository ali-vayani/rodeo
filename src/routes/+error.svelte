<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	/**
	 * Renders outside every layout, so it must not assume a session, a database, or
	 * anything else that might be what broke. Kept deliberately plain for that reason.
	 */
	const status = $derived(page.status);

	/**
	 * `page.error.message` is safe to show: SvelteKit replaces the message of an
	 * unexpected server error with "Internal Error" before it reaches the client. Only
	 * messages from an explicit `error()` call survive, and those are written to be read.
	 */
	const message = $derived(page.error?.message ?? 'Something went wrong.');

	const EXPLANATIONS: Record<number, string> = {
		403: "You're signed in, but this page isn't available to your account.",
		404: "That page doesn't exist. It may have been renamed or removed.",
		500: 'Something broke on our end. Trying again often works.'
	};

	const explanation = $derived(EXPLANATIONS[status] ?? message);
</script>

<svelte:head>
	<title>{status} · Rodeo</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-white px-6">
	<div class="w-full max-w-md text-center">
		<p class="font-mono text-xs tracking-widest text-muted-foreground uppercase">Error</p>
		<h1 class="mt-1 font-mono text-3xl font-bold tracking-widest text-primary">{status}</h1>

		<p class="mt-4 text-sm text-muted-foreground">{explanation}</p>

		{#if status !== 404 && message !== explanation}
			<p class="mt-2 font-mono text-xs text-muted-foreground">{message}</p>
		{/if}

		<a
			href={resolve('/')}
			class="mt-8 inline-block rounded bg-primary px-6 py-2 text-sm font-medium text-white transition-opacity hover:opacity-85"
		>
			Back to Rodeo
		</a>
	</div>
</div>
