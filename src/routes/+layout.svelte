<script lang="ts">
	import '../app.css';
	import { dev } from '$app/environment';
	import favicon from '$lib/assets/favicon.svg';
	import ToastHost from '$lib/components/patterns/ToastHost.svelte';

	let { children } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{@render children()}

<!-- Mounted once for the whole app; pages just call toast.success(...). -->
<ToastHost />

<!--
	DEV ONLY — the account switcher. `dev` is a build-time constant, so Rollup folds this
	branch away and never emits the chunk: in production the widget is absent rather than
	hidden. The import is dynamic rather than top-of-file to keep that true, and it has the
	happy side effect that the component never runs during SSR, so it can read localStorage
	at init with no `typeof window` guards.

	Last, after ToastHost, so it can never shift anything above it.

	To remove the feature: delete these lines, src/lib/dev, and src/routes/dev.
-->
{#if dev}
	{#await import('$lib/dev/DevAccountSwitcher.svelte') then { default: DevAccountSwitcher }}
		<DevAccountSwitcher />
	{/await}
{/if}
