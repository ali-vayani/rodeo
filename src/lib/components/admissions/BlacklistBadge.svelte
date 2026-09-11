<script lang="ts">
	import type { BlacklistMatch } from '$lib/blacklist/match';

	let { match, size = 'sm' }: { match: BlacklistMatch | null; size?: 'sm' | 'md' } = $props();

	// An email hit already auto-rejected, so it reads as a verdict. A name hit decided
	// nothing, so it reads as a question; fuzzy is faintest since it may be a misspelling.
	const VARIANTS: Record<BlacklistMatch, { label: string; title: string; class: string }> = {
		EMAIL: {
			label: 'Blacklisted',
			title: 'Email address is on the blacklist. This application was auto-rejected on submit.',
			class: 'bg-[#dc2626] text-white'
		},
		NAME_EXACT: {
			label: 'Name Blacklisted',
			title:
				'Name matches a blacklist entry exactly. No decision was made automatically -- verify this is the same person.',
			class: 'border border-white/60 bg-black/85 text-white'
		},
		NAME_FUZZY: {
			label: 'Possible Blacklist',
			title:
				'Name closely resembles a blacklist entry and may be a misspelling. No decision was made automatically -- verify before acting.',
			class: 'border border-white/60 bg-black/85 text-white'
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
