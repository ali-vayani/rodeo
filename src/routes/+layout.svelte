<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import ToastHost from '$lib/components/patterns/ToastHost.svelte';

	let { children } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{@render children()}

<!-- Mounted once for the whole app; pages just call toast.success(...). -->
<ToastHost />
