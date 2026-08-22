<script lang="ts">
	import { Eye } from 'lucide-svelte';
	import { resolve } from '$app/paths';
	import { Button, Modal } from '$lib/components/ui';
	import { isPdfFilename } from '$lib/application/files';

	let {
		userId,
		questionId,
		filename,
		class: className = ''
	}: {
		userId: string;
		questionId: string;
		/** A FILE question stores the uploaded file's name as its answer. */
		filename: string;
		/** Classes for the download link, so each surface keeps its own treatment. */
		class?: string;
	} = $props();

	let open = $state(false);

	const href = $derived(resolve('/files/[userId]/[questionId]', { userId, questionId }));
	const viewable = $derived(isPdfFilename(filename));
</script>

<!--
	A FILE answer, wherever one is shown. The route re-checks access on both hrefs, so
	viewing is available exactly where downloading already was.
-->
<span class="inline-flex items-baseline gap-2">
	<a {href} class={className}>{filename}</a>

	{#if viewable}
		<Button size="sm" variant="ghost" onclick={() => (open = true)}>
			<Eye class="size-3.5" />
			View
		</Button>
	{/if}
</span>

{#if viewable}
	<!--
		The browser's own PDF reader, which is why there is no toolbar of ours. bits-ui
		mounts the content only while open, so nothing is fetched until someone asks.
	-->
	<Modal bind:open title={filename} size="2xl" bodyClass="p-0">
		<iframe src="{href}?inline" title={filename} class="block pdf-frame w-full border-0"></iframe>
	</Modal>
{/if}
