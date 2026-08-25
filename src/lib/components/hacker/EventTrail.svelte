<script lang="ts">
	import BatLogo from '$lib/components/brand/BatLogo.svelte';
	import type { Milestone } from '$lib/application/timeline';

	/**
	 * The five funnel dates drawn as a route rather than a list: a date column, a
	 * hairline per stop, and the bat parked on the one the reader is waiting for.
	 *
	 * The marker keeps its column at `invisible` on every other stop so the grid does
	 * not reflow as an applicant moves through the funnel.
	 */
	let { milestones }: { milestones: Milestone[] } = $props();

	function formatDate(date: Date | null): string {
		if (!date) return 'To be announced';
		return new Date(date).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}
</script>

<ol class="list-none border-b border-brand-line p-0">
	{#each milestones as milestone (milestone.key)}
		<li
			aria-current={milestone.next ? 'step' : undefined}
			class="grid grid-cols-[1fr_auto] items-start gap-x-5 border-t py-4
			 md:grid-cols-[7rem_1fr_auto]
			 {milestone.next ? 'border-t-brand-purple' : 'border-t-brand-line'}"
		>
			<time
				datetime={milestone.date?.toISOString()}
				class="col-start-1 row-start-1 font-mono text-sm tracking-eyebrow uppercase md:mt-1
				 {milestone.next
					? 'text-brand-purple'
					: milestone.done
						? 'text-foreground-tertiary'
						: 'text-foreground'}"
			>
				{formatDate(milestone.date)}
			</time>

			<div
				class="col-span-2 col-start-1 row-start-2 mt-1 min-w-0 md:col-span-1 md:col-start-2
				 md:row-start-1 md:mt-0"
			>
				<h3
					class="text-xl font-bold {milestone.done
						? 'text-foreground-tertiary'
						: 'text-foreground'}"
				>
					{milestone.label}
				</h3>
				<p class="mt-1 text-md leading-relaxed text-foreground-secondary">{milestone.detail}</p>
			</div>

			<span
				class="col-start-2 row-start-1 flex items-center gap-2 justify-self-end md:col-start-3
				 {milestone.next ? '' : 'invisible'}"
			>
				<span class="font-mono text-2xs tracking-eyebrow text-brand-purple uppercase">Next up</span>
				<BatLogo class="w-7 text-brand-ink" />
			</span>
		</li>
	{/each}
</ol>
