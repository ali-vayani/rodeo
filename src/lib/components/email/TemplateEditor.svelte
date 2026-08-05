<script lang="ts">
	import { TEMPLATE_VARIABLES } from '$lib/email/variables';

	let {
		label,
		subject = $bindable(),
		body = $bindable()
	}: {
		label: string;
		subject: string;
		body: string;
	} = $props();

	let subjectEl = $state<HTMLInputElement | undefined>(undefined);
	let bodyEl = $state<HTMLTextAreaElement | undefined>(undefined);
	/** Which field a variable chip inserts into. Body is the common case. */
	let lastFocused = $state<'subject' | 'body'>('body');

	function insertVariable(key: string) {
		const token = `{{${key}}}`;
		const el = lastFocused === 'subject' ? subjectEl : bodyEl;
		if (!el) return;

		const start = el.selectionStart ?? el.value.length;
		const end = el.selectionEnd ?? start;
		const next = el.value.slice(0, start) + token + el.value.slice(end);

		if (lastFocused === 'subject') {
			subject = next;
		} else {
			body = next;
		}

		// Restore the caret after the inserted token once Svelte has written the value back.
		const caret = start + token.length;
		requestAnimationFrame(() => {
			el.focus();
			el.setSelectionRange(caret, caret);
		});
	}
</script>

<div class="flex min-h-0 flex-1 flex-col gap-3">
	<div class="flex flex-col gap-1.5">
		<label
			for="template-subject"
			class="text-[10px] font-bold tracking-widest text-muted-foreground uppercase"
		>
			Subject
		</label>
		<input
			id="template-subject"
			bind:this={subjectEl}
			bind:value={subject}
			onfocus={() => (lastFocused = 'subject')}
			maxlength="200"
			placeholder="Subject line for the {label} email"
			class="w-full rounded border border-border bg-white px-3 py-[7px] text-[13px] text-primary outline-none focus:border-primary"
		/>
	</div>

	<div class="flex flex-wrap items-center gap-1.5">
		<span class="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
			Insert
		</span>
		{#each TEMPLATE_VARIABLES as v (v.key)}
			<button
				type="button"
				onclick={() => insertVariable(v.key)}
				title="{v.label} — e.g. {v.sample}"
				class="cursor-pointer rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-primary hover:bg-[#ebebeb]"
			>
				{'{{' + v.key + '}}'}
			</button>
		{/each}
	</div>

	<div class="flex min-h-0 flex-1 flex-col gap-1.5">
		<label
			for="template-body"
			class="text-[10px] font-bold tracking-widest text-muted-foreground uppercase"
		>
			Body
		</label>
		<textarea
			id="template-body"
			bind:this={bodyEl}
			bind:value={body}
			onfocus={() => (lastFocused = 'body')}
			placeholder="Body of the {label} email"
			class="min-h-0 w-full flex-1 resize-none rounded border border-border bg-white px-3 py-2 font-mono text-[13px] leading-relaxed text-primary outline-none focus:border-primary"
		></textarea>
	</div>
</div>
