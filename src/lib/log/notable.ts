import type { Tone } from '$lib/ui/tone';
import type { LogAction } from './actions';

/**
 * The actions the dashboard feed marks with a filled dot: irreversible,
 * outward-facing, or unusual. This used to be substring matching over a free-text
 * sentence, which quietly marked anything containing "accept", declines included.
 */
// Typed `ReadonlySet<string>` at the boundary but built from `LogAction`: entries
// arrive from the database as plain strings, while a typo below is a compile error.
export const NOTABLE_ACTIONS: ReadonlySet<string> = new Set<LogAction>([
	'admissions.release',
	// One click, arbitrarily many applicants. Still reversible until release, hence a dot
	// rather than a warning tone, but it explains why two hundred rows changed at 3am.
	'admissions.decision.bulk',
	'admissions.decision.blocked',
	'user.decision.override',
	'user.export',
	// The whole database, out the door or gone entirely. `data.wipe` is written after the
	// wipe has emptied `Log`, so it is usually the oldest entry in the feed.
	'data.export',
	'data.wipe',
	'email.custom.send',
	'blacklist.import',
	'question.delete',
	'settings.update'
]);

/**
 * Badge tone for an action slug on `/admin/logs`. Deliberately sparse: red for the
 * entries someone is scanning the page to find, amber for the irreversible batch
 * actions, neutral for the rest.
 */
export function actionTone(action: string): Tone {
	switch (action) {
		case 'admissions.decision.blocked':
		case 'user.decision.override':
		case 'user.export':
		case 'data.export':
		case 'data.wipe':
			return 'danger';
		case 'admissions.release':
		case 'email.custom.send':
		case 'blacklist.import':
			return 'warning';
		default:
			return 'neutral';
	}
}
