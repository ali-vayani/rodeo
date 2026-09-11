<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Snippet } from 'svelte';
	import type { LayoutData } from './$types';
	import { canAccess } from '$lib/auth/permissions';
	import SidebarNav from '$lib/components/patterns/SidebarNav.svelte';
	import { navigating } from '$app/stores';

	let { children, data }: { children: Snippet; data: LayoutData } = $props();

	// `as const` so each href stays a literal: `resolve` is typed against the generated
	// route union, and a widened `string` would fail to typecheck, which also catches a
	// link to a route that does not exist.
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

	// Cosmetic only: hooks.server.ts is what actually denies these routes.
	const visibleLinks = $derived(
		links
			.filter((l) => canAccess(data.role, l.section))
			.map((l) => ({ href: resolve(l.href), label: l.label }))
	);
</script>

<div class="flex min-h-screen">
	<SidebarNav links={visibleLinks} />

	<main class="mt-topbar min-h-screen min-w-0 flex-1 bg-muted p-4 md:mt-0 md:ml-sidebar md:p-8">
		{#if $navigating}
			<div class="flex h-full items-center justify-center py-32">
				<div class="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-primary"></div>
			</div>
		{:else}
			{@render children()}
		{/if}
	</main>
</div>
