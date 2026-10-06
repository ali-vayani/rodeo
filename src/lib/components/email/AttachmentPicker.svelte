<script lang="ts">
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui';
	import { formatFileSize } from '$lib/format';
	import {
		attachmentPreviewUrl,
		MAX_EMAIL_ATTACHMENTS,
		MAX_EMAIL_ATTACHMENT_BYTES,
		type EmailAttachmentRef
	} from '$lib/email/attachments';

	let {
		attachments = $bindable([]),
		uploading = $bindable(false),
		disabled = false,
		onError,
		onRemove
	}: {
		attachments: EmailAttachmentRef[];
		uploading?: boolean;
		disabled?: boolean;
		onError: (message: string) => void;
		onRemove?: (ref: EmailAttachmentRef) => void;
	} = $props();
	let fileInput = $state<HTMLInputElement | null>(null);

	/**
	 * Uploads each picked file and keeps the ref. Sequential rather than parallel:
	 * these proxy through one function each, and a burst of 4 MB bodies buys nothing
	 * but a harder-to-read failure when one of them is refused.
	 */
	async function attachFiles(picked: FileList | null) {
		const files = Array.from(picked ?? []);
		if (disabled || uploading || files.length === 0) return;
		if (attachments.length + files.length > MAX_EMAIL_ATTACHMENTS) {
			onError(`At most ${MAX_EMAIL_ATTACHMENTS} attachments per email.`);
			return;
		}

		uploading = true;
		try {
			for (const file of files) {
				// Checked here as well as server-side, because past the platform's body cap
				// the refusal is a bare 413 with no message worth showing.
				if (file.size > MAX_EMAIL_ATTACHMENT_BYTES) {
					const limit = Math.floor(MAX_EMAIL_ATTACHMENT_BYTES / (1024 * 1024));
					onError(`${file.name} is ${formatFileSize(file.size)}. The limit is ${limit} MB.`);
					continue;
				}

				const form = new FormData();
				form.append('file', file);
				const res = await fetch('/admin/custom-email/attachments', {
					method: 'POST',
					body: form
				});
				if (!res.ok) {
					const reason = await res
						.json()
						.then((b) => b?.message)
						.catch(() => null);
					onError(reason ?? `Upload of ${file.name} failed (${res.status})`);
					continue;
				}
				attachments = [...attachments, await res.json()];
			}
		} catch (e: unknown) {
			onError(e instanceof Error ? e.message : 'Attachment upload failed. Try again.');
		} finally {
			uploading = false;
		}
	}

	function removeAttachment(ref: EmailAttachmentRef) {
		if (disabled || uploading) return;
		attachments = attachments.filter((a) => a.key !== ref.key);
		onRemove?.(ref);
	}
</script>

<div class="flex flex-col gap-2">
	<div class="flex items-center justify-between">
		<span class="text-sm font-medium text-foreground">Attachments</span>
		<span class="text-xs text-foreground-secondary">
			Up to {MAX_EMAIL_ATTACHMENTS} files, {Math.floor(MAX_EMAIL_ATTACHMENT_BYTES / (1024 * 1024))} MB
			each. Every recipient gets the same files.
		</span>
	</div>

	{#each attachments as ref (ref.key)}
		<div
			class="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2"
		>
			<a
				href={resolve(attachmentPreviewUrl(ref))}
				target="_blank"
				rel="noopener noreferrer"
				class="min-w-0 truncate text-base text-foreground underline underline-offset-2"
				title="Open attachment in a new tab">{ref.filename}</a
			>
			<span class="shrink-0 text-xs text-foreground-secondary">{formatFileSize(ref.size)}</span>
			<Button
				size="sm"
				variant="ghost"
				disabled={disabled || uploading}
				onclick={() => removeAttachment(ref)}
			>
				Remove
			</Button>
		</div>
	{/each}

	<input
		bind:this={fileInput}
		type="file"
		multiple
		class="hidden"
		onchange={(e) => {
			const input = e.target as HTMLInputElement;
			attachFiles(input.files);
			// Clear it so re-picking the same file fires `change` again, letting a
			// failed upload be retried.
			input.value = '';
		}}
	/>
	<Button
		class="self-start"
		onclick={() => fileInput?.click()}
		loading={uploading}
		disabled={disabled || uploading || attachments.length >= MAX_EMAIL_ATTACHMENTS}
	>
		Attach files
	</Button>
</div>
