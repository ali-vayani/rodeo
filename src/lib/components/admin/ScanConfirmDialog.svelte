<script lang="ts">
	import type { Role, UserStatus } from '$lib/generated/prisma/client';

	interface DialogUser {
		uid: string;
		name: string;
		email: string;
		university: string | null;
		year: string | null;
		roles: Role[];
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

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) onCancel();
	}
</script>

{#if isOpen && user}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-5 backdrop-blur-[3px]"
		onclick={handleBackdropClick}
		onkeydown={(e) => e.key === 'Escape' && onCancel()}
	>
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Confirm Scan"
			class="flex max-h-[85vh] w-[440px] max-w-[calc(100vw-48px)] flex-col overflow-hidden rounded-lg bg-white shadow-[0_8px_32px_rgba(0,0,0,0.18)]"
		>
			<div class="border-b border-border px-6 pt-5 pb-4">
				<div class="text-[16px] font-bold text-primary">{user.name}</div>
				<div class="mt-1 font-mono text-[11px] text-muted-foreground capitalize">
					{user.roles.join(', ')} &middot; {user.status.replace('_', ' ')}
				</div>
			</div>

			<div class="flex flex-col gap-2.5 overflow-y-auto px-6 py-5">
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
							Already scanned {scanCountForAction}&times; for {action} — confirming will still record
							this scan.
						</p>
					</div>
				{/if}
			</div>

			<div class="flex justify-end gap-[10px] border-t border-border px-6 py-4">
				<button
					onclick={onCancel}
					disabled={isConfirming}
					class="cursor-pointer rounded-md border border-border bg-white px-4 py-2 text-[13px] font-medium text-primary disabled:cursor-not-allowed disabled:opacity-50"
				>
					Cancel
				</button>
				<button
					onclick={onConfirm}
					disabled={isConfirming}
					class="flex cursor-pointer items-center gap-2 rounded-md border border-primary bg-primary px-[18px] py-2 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
				>
					{#if isConfirming}
						<span
							class="h-[13px] w-[13px] animate-spin rounded-full border-2 border-white/30 border-t-white"
						></span>
						Recording…
					{:else}
						Confirm Scan
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}
