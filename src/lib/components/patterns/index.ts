/**
 * Composed, Rodeo-aware components.
 *
 * These know about users, decisions, and scans, and are built only from
 * `$lib/components/ui`. See docs/design-language.md.
 *
 *     import { PageHeader, DataTable } from '$lib/components/patterns';
 */

export { default as ConfirmDialog } from './ConfirmDialog.svelte';
export { default as DataTable } from './DataTable.svelte';
export { default as FilterGroup } from './FilterGroup.svelte';
export { default as PageHeader } from './PageHeader.svelte';
export { default as Pagination } from './Pagination.svelte';
export { default as SidebarNav } from './SidebarNav.svelte';
export { default as StatCard } from './StatCard.svelte';
export { default as Tabs } from './Tabs.svelte';
export { default as ToastHost } from './ToastHost.svelte';

export type { TabItem, Column } from '$lib/components/ui/types';
