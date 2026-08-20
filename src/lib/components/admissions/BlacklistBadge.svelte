<script lang="ts">
	import type { BlacklistMatch } from '$lib/blacklist/match';

	let { match, size = 'sm' }: { match: BlacklistMatch | null; size?: 'sm' | 'md' } = $props();

	/**
	 * Three signals, three weights. The badge has to say which one fired, because they mean
	 * very different things to a reviewer.
	 *
	 * An email hit already rejected this applicant automatically, so it reads as a verdict.
	 * A name hit decided nothing, so it reads as a question, and the fuzzy variant is
	 * faintest because it can be a misspelling of an unrelated person's name.
	 */
	const VARIANTS: Record<BlacklistMatch, { label: string; title: string; class: string }> = {
		EMAIL: {
			label: 'Blacklisted',
			title: 'Email address is on the blacklist. This application was auto-rejected on submit.',
			class: 'bg-[#dc2626] text-white'
		},
		NAME_EXACT: {
			label: 'Name match',
			title:
				'Name matches a blacklist entry exactly. No decision was made automatically -- verify this is the same person.',
			class: 'bg-[#fef3c7] text-[#92400e]'
		},
		NAME_FUZZY: {
			label: 'Possible match',
			title:
				'Name closely resembles a blacklist entry and may be a misspelling. No decision was made automatically -- verify before acting.',
			class: 'border border-[#fde68a] bg-[#fffbeb] text-[#b45309]'
		}
	};

	const variant = $derived(match ? VARIANTS[match] : null);
	const sizeClass = $derived(
		size === 'md' ? 'px-2 py-[3px] text-[11px] tracking-[0.04em]' : 'px-1.5 py-0.5 text-[10px]'
	);
</script>

{#if variant}
	<span
		title={variant.title}
		class="inline-flex shrink-0 items-center gap-1 rounded font-semibold whitespace-nowrap {variant.class} {sizeClass}"
	>
		{variant.label}
	</span>
{/if}
