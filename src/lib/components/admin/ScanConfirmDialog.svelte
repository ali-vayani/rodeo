<script lang="ts">
	import type { Role, UserStatus } from '$lib/generated/prisma/client';
	import { Modal, Button } from '$lib/components/ui';

	interface DialogUser {
		uid: string;
		name: string;
		email: string;
		university: string | null;
		year: string | null;
		role: Role;
		status: UserStatus;
	}

	interface Props {
		isOpen: boolean;
		user: DialogUser | null;
		action: string;
		isDuplicate: boolean;
		scanCountForAction: number;
		warning: 'UNCONFIRMED_HACKER' | null;
		isConfirming?: boolean;
		onConfirm: () => void;
		onCancel: () => void;
	}

	let {
		isOpen,
		user,
		action,
		isDuplicate,
		scanCountForAction,
		warning,
		isConfirming = false,
		onConfirm,
		onCancel
	}: Props = $props();
</script>

<!-- `open` is not bound: the parent owns it, and every dismissal path funnels
     through onClose -> onCancel so the camera resumes. -->
<Modal
	open={isOpen && user !== null}
	title={user?.name ?? ''}
	description={user ? `${user.role} · ${user.status.replace('_', ' ')}` : undefined}
	size="md"
	dismissible={!isConfirming}
	onClose={onCancel}
>
	{#if user}
		<div class="flex flex-col gap-2.5">
			<div class="flex justify-between gap-3 text-[13px]">
				<span class="shrink-0 text-muted-foreground">Email</span>
				<span class="truncate font-medium text-primary">{user.email}</span>
			</div>
			{#if user.university}
				<div class="flex justify-between gap-3 text-[13px]">
					<span class="shrink-0 text-muted-foreground">University</span>
					<span class="truncate font-medium text-primary">{user.university}</span>
				</div>
			{/if}
			<div class="flex justify-between gap-3 text-[13px]">
				<span class="shrink-0 text-muted-foreground">Scanning for</span>
				<span class="truncate font-medium text-primary">{action}</span>
			</div>

			{#if warning === 'UNCONFIRMED_HACKER'}
				<div
					class="mt-1 flex items-start gap-2 rounded border border-[#fde68a] bg-[#fffbeb] px-[14px] py-3"
				>
					<svg
						class="mt-px shrink-0 text-[#92400e]"
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path
							d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
						></path>
						<line x1="12" y1="9" x2="12" y2="13"></line>
						<line x1="12" y1="17" x2="12.01" y2="17"></line>
					</svg>
					<p class="text-[13px] leading-[1.5] text-[#92400e]">
						Status is <strong>{user.status.replace('_', ' ')}</strong> — this hacker hasn't confirmed
						attendance.
					</p>
				</div>
			{/if}

			{#if isDuplicate}
				<div
					class="mt-1 flex items-start gap-2 rounded border border-[#fde68a] bg-[#fffbeb] px-[14px] py-3"
				>
					<svg
						class="mt-px shrink-0 text-[#92400e]"
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path
							d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
						></path>
						<line x1="12" y1="9" x2="12" y2="13"></line>
						<line x1="12" y1="17" x2="12.01" y2="17"></line>
					</svg>
					<p class="text-[13px] leading-[1.5] text-[#92400e]">
						Already scanned {scanCountForAction}&times; for {action} — confirming will still record this
						scan.
					</p>
				</div>
			{/if}
		</div>
	{/if}

	{#snippet footer()}
		<Button size="lg" variant="secondary" onclick={onCancel} disabled={isConfirming}>Cancel</Button>
		<Button size="lg" variant="primary" onclick={onConfirm} loading={isConfirming}>
			Confirm Scan
		</Button>
	{/snippet}
</Modal>
