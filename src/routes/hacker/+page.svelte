<script lang="ts">
	import { resolve } from '$app/paths';
	import poster from '$lib/assets/poster.png';
	import BracketFrame from '$lib/components/brand/BracketFrame.svelte';
	import EventTrail from '$lib/components/hacker/EventTrail.svelte';
	import { computeApplicationState, getApplicationStateLabel } from '$lib/application/state';
	import { buildTimeline } from '$lib/application/timeline';
	import { applicationWindowState } from '$lib/application/window';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const state = $derived(computeApplicationState(data.user));
	const windowState = $derived(applicationWindowState(data.settings));
	const milestones = $derived(buildTimeline(data.settings, state));

	const APPLICATION = resolve('/hacker/application');
	const ACCOUNT = resolve('/hacker/account');

	type Gate = {
		headline: string;
		note: string;
		action: { label: string; href: string } | null;
	};

	/**
	 * The headline and single next action for each funnel state.
	 *
	 * Deliberately one line and one button per state: the Application and Account pages
	 * own the detail, and this page's job is to say where you are and where to go. The
	 * `filling` copy depends on the window as well, so it is resolved separately.
	 */
	const GATES: Record<Exclude<typeof state, 'filling'>, Gate> = {
		submitted: {
			headline: 'Your application is in',
			note: "Nothing left to do. We'll email you when decisions go out.",
			action: { label: 'Check your status', href: APPLICATION }
		},
		accepted: {
			headline: "You're in",
			note: 'Confirm your spot before the RSVP deadline to secure your place.',
			action: { label: 'Confirm your spot', href: APPLICATION }
		},
		waitlisted: {
			headline: "You're on the waitlist",
			note: "Spots open up as accepted hackers drop. We'll email you if one does.",
			action: null
		},
		rejected: {
			headline: 'Not this time',
			note: "We had far more applications than spots. We'd like to see you apply again.",
			action: null
		},
		rsvpd: {
			headline: 'See you at the hackathon',
			note: 'Your spot is locked in. Event details are on their way by email.',
			action: { label: 'Get your check-in code', href: ACCOUNT }
		},
		declined: {
			headline: 'Invitation declined',
			note: 'Your spot has been released. We hope to see you at a future event.',
			action: null
		},
		'checked-in': {
			headline: "You're here. Go build",
			note: 'Have a good one.',
			action: { label: 'Get your check-in code', href: ACCOUNT }
		}
	};

	const FILLING: Record<typeof windowState, Gate> = {
		before: {
			headline: 'Applications open soon',
			note: 'You can read the questions now and answer them once the form opens.',
			action: { label: 'Read the questions', href: APPLICATION }
		},
		open: {
			headline: 'Applications are open',
			note: "Your application isn't submitted yet. Answers save as you type.",
			action: { label: 'Continue your application', href: APPLICATION }
		},
		closed: {
			headline: 'Applications are closed',
			note: 'The deadline passed before your application was submitted.',
			action: { label: 'View your application', href: APPLICATION }
		}
	};

	const gate = $derived(state === 'filling' ? FILLING[windowState] : GATES[state]);

	const statusLabel = $derived(getApplicationStateLabel(data.user));
</script>

<header class="mb-6">
	<h1 class="font-display text-display font-extrabold tracking-wide text-white uppercase">
		{gate.headline}
	</h1>
	<p class="mt-1 text-md text-white/80">{gate.note}</p>
</header>

<!--
	One card, split the way the Trail direction splits it: the poster and your own status
	on the left, the route on the right. The brackets mark it as the page's subject, the
	same way they do on the application's status card.
-->
<div class="relative bg-card p-6 shadow-float md:p-10">
	<BracketFrame class="inset-3.5 text-brand-ink" arm="size-5" />

	<div class="grid gap-8 md:grid-cols-[16rem_1fr] md:gap-12">
		<aside class="min-w-0">
			<!--
				The event poster, hardcoded. Its printed dates are set in the artwork, so they
				will not follow a Settings edit the way the trail beside it does — swap the file
				when the poster changes.
			-->
			<img
				src={poster}
				alt="HackTX 26 poster — October 24–25 at UT Austin."
				width="1080"
				height="1350"
				class="block h-auto w-full shadow-float"
			/>

			<div class="mt-5">
				{#if statusLabel}
					<!--
						Not the admin's status pill: its tone ramp and dot are triage chrome, and out
						here there is only one row to read. Set the way the trail beside it sets a stop
						— mono eyebrow, hairline, the answer in the display face.
					-->
					<div class="flex items-baseline justify-between gap-3 border-y border-brand-line py-3">
						<span class="font-mono text-2xs tracking-eyebrow text-foreground-tertiary uppercase">
							Status
						</span>
						<span class="font-display text-xl font-bold text-brand-purple">{statusLabel}</span>
					</div>
				{/if}
				<p class="mt-4 text-md leading-relaxed text-foreground-secondary">
					Signed in as <span class="font-semibold text-foreground">{data.user.name}</span>.
				</p>

				{#if gate.action}
					<!--
						Both hrefs in GATES/FILLING are already resolve()'d above, where the routes
						are literals the checker can see. Same tradeoff as HackerRail's nav links.
					-->
					<!-- eslint-disable svelte/no-navigation-without-resolve -->
					<a
						href={gate.action.href}
						class="mt-4 block w-full bg-brand-purple px-5 py-2.5 text-center font-display
						 text-md font-semibold text-white no-underline transition-colors duration-150
						 hover:bg-brand-purple-hover focus-visible:shadow-ring"
					>
						{gate.action.label}
					</a>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				{/if}
			</div>
		</aside>

		{#if milestones.length > 0}
			<EventTrail {milestones} />
		{:else}
			<!--
				No Settings row yet, so there are no real dates to draw. Says so rather than
				rendering five stops that all read as today.
			-->
			<p class="text-md leading-relaxed text-foreground-secondary">
				The schedule hasn't been published yet. Check back — we'll post the deadlines here as soon
				as they're set.
			</p>
		{/if}
	</div>
</div>
