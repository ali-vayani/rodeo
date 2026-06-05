<script lang="ts">
	import { untrack } from 'svelte';
	import { createClient } from '$lib/trpc/client';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();

	const trpc = createClient();

	type Settings = (typeof data.settings);

	let settings = $state<Settings[]>(untrack(() => [data.settings]));

	console.log(settings)

</script>

<!-- Page header -->
<div class="flex items-center justify-between mb-4">
	<h1 class="text-[22px] font-bold text-primary">Settings</h1>
</div>

<!-- Split pane -->
<div class="flex bg-white border border-border rounded-md overflow-hidden h-[calc(100vh-136px)]">
	<div>
		<div>
			<h3>Hackathon Name</h3>
			<input type="text" class="border border-border" />
		</div>
		<div>
			<div>
				<h3>Timezone</h3>
				<input type="text" class="border border-border" />
			</div>
			<div>
				<h3>Max Team Size</h3>
				<input type="text" class="border border-border" />
			</div>
		</div>
		<div>
			<div>
				<h3>Application Deadline</h3>
				<input type="date" class="border border-border" />
			</div>
			<div>
				<h3>RSVP Deadline</h3>
				<input type="date" class="border border-border" />
			</div>
		</div>

	</div>
</div>
