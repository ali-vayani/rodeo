<script lang="ts">
	import type { PageData } from './$types';
	import AccountTab from '$lib/components/settings/AccountTab.svelte';

	let { data }: { data: PageData } = $props();
</script>

<h1 class="mb-4 text-2xl font-bold text-primary">Account</h1>
<div class="max-w-lg rounded-md border border-border bg-card p-6">
	<AccountTab me={data.me} />
</div>
