<script lang="ts">
	import { page } from '$app/state';

	let { children } = $props();

	const links = [
		{ href: '/hacker/application', label: 'Application' },
		{ href: '/hacker/account', label: 'Account' }
	];
</script>

<div class="flex min-h-screen">
	<!-- Sidebar -->
	<nav
		class="fixed top-0 left-0 flex h-full w-[210px] flex-col border-r bg-white"
		style="border-color: #e0e0e0"
	>
		<div class="px-5 py-5">
			<span class="font-mono text-lg font-medium" style="color: #191919">rodeo</span>
		</div>
		<ul class="mt-1 flex flex-1 flex-col gap-0.5 px-3">
			{#each links as link}
				<li>
					<a
						href={link.href}
						class="block rounded px-3 py-2 text-sm transition-colors"
						style={page.url.pathname === link.href
							? 'background: #191919; color: #fff;'
							: 'color: #191919;'}
					>
						{link.label}
					</a>
				</li>
			{/each}
		</ul>
		<form method="POST" action="/logout" class="border-t p-3" style="border-color: #e0e0e0">
			<button
				type="submit"
				class="block w-full rounded px-3 py-2 text-left text-sm transition-colors hover:bg-[#f4f4f4]"
				style="color: #191919"
			>
				Log out
			</button>
		</form>
	</nav>

	<!-- Main content -->
	<main class="ml-[210px] min-h-screen flex-1 p-8" style="background: #f4f4f4">
		{@render children()}
	</main>
</div>
