<script lang="ts" module>
	/**
	 * Everything the person submitted, plus the two relations that say where they sit in
	 * the event. Typed structurally rather than off the router so this component stays
	 * free of server imports, and the responses use the same shape `ApplicantDetail` takes.
	 */
	export type ProfileData = {
		application: Array<{
			id: string;
			value: string;
			userId: string;
			questionId: string;
			question: { title: string; order: number; type: string };
		}>;
		team: { teamName: string; members: Array<{ uid: string; name: string }> } | null;
		scans: Array<{ id: string; action: string; timestamp: Date | string }>;
	};
</script>

<script lang="ts">
	import { Eyebrow, Spinner } from '$lib/components/ui';
	import FileAnswer from '$lib/components/files/FileAnswer.svelte';
	import { formatDateTime, humanizeEnum, pluralize } from '$lib/format';

	let {
		profile,
		loading = false,
		error = null
	}: {
		/** null while the fetch is in flight or has failed. */
		profile: ProfileData | null;
		loading?: boolean;
		error?: string | null;
	} = $props();

	// The payload already arrives in `question.order` — user.getById sorts it — so
	// this is a display concern only, not a re-sort.
	let responses = $derived(profile?.application ?? []);
</script>

<!--
	The read-only half of the user detail modal: the application answers, the team, and
	the scan trail. The editing controls live above this in the modal.
-->
<section class="flex flex-col gap-5 border-t border-border pt-5">
	<div>
		<div class="mb-3 flex items-baseline justify-between gap-3">
			<Eyebrow>Application</Eyebrow>
			{#if profile && responses.length > 0}
				<span class="font-mono text-2xs text-foreground-tertiary">
					{pluralize(responses.length, 'answer')}
				</span>
			{/if}
		</div>

		{#if loading}
			<!-- The modal is already open and editable by now; only this half is waiting. -->
			<div class="flex items-center gap-2 py-4 text-base text-foreground-secondary">
				<Spinner label="" />
				Loading application…
			</div>
		{:else if error}
			<div
				class="rounded-md border border-danger-200 bg-danger-50 px-3 py-2.5 text-base text-danger-700"
			>
				{error}
			</div>
		{:else if responses.length === 0}
			<!-- A real state, not a failure: most staff accounts never applied. -->
			<div
				class="rounded-md border border-dashed border-border bg-muted px-3 py-4 text-center text-base text-foreground-secondary"
			>
				No application submitted.
			</div>
		{:else}
			<dl class="m-0 flex flex-col gap-4">
				{#each responses as response (response.id)}
					<div>
						<dt class="mb-1.5 text-sm font-semibold text-foreground-secondary">
							{response.question.title}
						</dt>
						<!--
													Each answer scrolls inside its own box. Essay questions run to several
													paragraphs, and without a cap one pushes every other answer out of reach.
												-->
						<dd
							class="m-0 max-h-40 overflow-y-auto rounded-md border border-border bg-muted px-3 py-2.5
							       text-base leading-relaxed break-words whitespace-pre-wrap text-foreground"
						>
							{#if response.question.type === 'FILE' && response.value.trim()}
								<!-- A link, not text: the value is a filename. -->
								<FileAnswer
									userId={response.userId}
									questionId={response.questionId}
									filename={response.value}
									class="underline underline-offset-2"
								/>
							{:else if response.value.trim()}
								{response.value}
							{:else}
								<!-- Answered with nothing is not the same as never asked. -->
								<span class="text-foreground-tertiary italic">Left blank</span>
							{/if}
						</dd>
					</div>
				{/each}
			</dl>
		{/if}
	</div>

	{#if profile?.team}
		<div>
			<Eyebrow class="mb-2">Team</Eyebrow>
			<div class="text-base font-medium text-foreground">{profile.team.teamName}</div>
			<div class="mt-1 text-sm text-foreground-secondary">
				{profile.team.members.map((m) => m.name).join(', ')}
			</div>
		</div>
	{/if}

	{#if profile && profile.scans.length > 0}
		<div>
			<Eyebrow class="mb-2">Scans</Eyebrow>
			<ul class="m-0 flex max-h-40 list-none flex-col gap-1 overflow-y-auto p-0">
				{#each profile.scans as scan (scan.id)}
					<li
						class="flex flex-wrap items-baseline justify-between gap-x-3 text-base text-foreground"
					>
						<span class="min-w-0 break-words">{humanizeEnum(scan.action)}</span>
						<span class="font-mono text-xs whitespace-nowrap text-foreground-tertiary">
							{formatDateTime(scan.timestamp)}
						</span>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</section>
