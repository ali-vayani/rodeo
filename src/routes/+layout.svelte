<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import ToastHost from '$lib/components/patterns/ToastHost.svelte';

	let { children, data } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{@render children()}

<!-- Mounted once for the whole app; pages just call toast.success(...). -->
<ToastHost />

<!--
	The account switcher: `vite dev` and preview deploys, decided server-side by
	devSwitcherEnabled. Production bundles do not contain the chunk at all, since
	vite.config.ts empties src/lib/dev/ out of VERCEL_ENV=production builds. The import
	is dynamic so the chunk loads only when mounted, and never during SSR, so the
	component can read localStorage at init with no `typeof window` guards.

	Last, after ToastHost, so it can never shift anything above it.

	To remove the feature: delete these lines, src/routes/+layout.server.ts,
	src/lib/dev, and src/routes/dev.
-->
{#if data.devSwitcher}
	{#await import('$lib/dev/DevAccountSwitcher.svelte') then { default: DevAccountSwitcher }}
		<DevAccountSwitcher />
	{/await}
{/if}
