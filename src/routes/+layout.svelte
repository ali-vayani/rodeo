<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { env } from '$env/dynamic/public';
	import { startRejourneyOnMount, Rejourney } from '@rejourneyco/browser/svelte';
	import favicon from '$lib/assets/favicon.svg';
	import ToastHost from '$lib/components/patterns/ToastHost.svelte';

	let { children, data } = $props();

	// Rejourney observability: session replay, route/network/error capture. Wholly
	// off wherever the key is unset — local dev and any deploy that hasn't opted in.
	// See the Observability section of .env.example for setup.
	onMount(() => {
		if (!env.PUBLIC_REJOURNEY_KEY) return;
		// Returns a cleanup that stops recording if the root layout ever unmounts.
		return startRejourneyOnMount({ publicKey: env.PUBLIC_REJOURNEY_KEY });
	});

	// Identity follows the session cookie, not the page: login and logout are form
	// actions whose redirects re-run the layout load, so data.userId flips without
	// a full reload. The SDK queues identity set before init resolves, so ordering
	// against onMount doesn't matter.
	$effect(() => {
		if (!env.PUBLIC_REJOURNEY_KEY) return;
		if (data.userId) {
			Rejourney.setUserIdentity(data.userId);
			if (data.userRole) Rejourney.setMetadata('role', data.userRole);
		} else {
			Rejourney.clearUserIdentity();
		}
	});
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
