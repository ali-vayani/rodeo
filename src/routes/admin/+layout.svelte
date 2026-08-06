<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { Snippet } from 'svelte';
	import type { LayoutData } from './$types';
	import { canAccess } from '$lib/auth/permissions';

	let { children, data }: { children: Snippet; data: LayoutData } = $props();

	// `as const` so each href stays a literal: `resolve` is typed against the
	// generated route union, and a widened `string` would fail to typecheck —
	// which is the whole point, since it also catches a link to a route that
	// doesn't exist. The section literals stay narrow too, so `canAccess`
	// typechecks them against AdminSection.
	const links = [
		{ href: '/admin/dashboard', label: 'Dashboard', section: 'dashboard' },
		{ href: '/admin/users', label: 'Users', section: 'users' },
		{ href: '/admin/admissions', label: 'Admissions', section: 'admissions' },
		{ href: '/admin/scan', label: 'Scan', section: 'scan' },
		{ href: '/admin/email-templates', label: 'Email Templates', section: 'email' },
		{ href: '/admin/custom-email', label: 'Custom Email', section: 'email' },
		{
			href: '/admin/application-editor',
			label: 'Application Editor',
			section: 'application-editor'
		},
		{ href: '/admin/schedule', label: 'Schedule', section: 'schedule' },
		{ href: '/admin/blacklist', label: 'Blacklist', section: 'blacklist' },
		{ href: '/admin/logs', label: 'Activity Log', section: 'logs' },
		{ href: '/admin/settings', label: 'Settings', section: 'settings' }
	] as const;

	// Cosmetic only — hooks.server.ts is what actually denies these routes.
	const visibleLinks = $derived(links.filter((l) => canAccess(data.role, l.section)));
</script>

<div class="flex min-h-screen">
	<!-- Sidebar -->
	<nav class="fixed top-0 left-0 flex h-full w-[210px] flex-col border-r border-border bg-white">
		<div class="px-5 py-5">
			<span class="font-mono text-lg font-medium text-primary">rodeo</span>
		</div>
		<ul class="mt-1 flex flex-1 flex-col gap-0.5 px-3">
			{#each visibleLinks as link (link.href)}
				<li>
					<a
						href={resolve(link.href)}
						class="block rounded px-3 py-2 text-sm transition-colors {page.url.pathname ===
						link.href
							? 'bg-primary text-white'
							: 'text-primary'}"
					>
						{link.label}
					</a>
				</li>
			{/each}
		</ul>
		<form method="POST" action="/logout" class="border-t border-border p-3">
			<button
				type="submit"
				class="block w-full rounded px-3 py-2 text-left text-sm text-primary transition-colors hover:bg-[#f4f4f4]"
			>
				Log out
			</button>
		</form>
	</nav>

	<!-- Main content -->
	<main class="ml-[210px] min-h-screen flex-1 bg-muted p-8">
		{@render children()}
	</main>
</div>
