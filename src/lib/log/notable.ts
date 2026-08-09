import type { Tone } from '$lib/ui/tone';
import type { LogAction } from './actions';

/**
 * The actions the dashboard feed marks with a filled dot.
 *
 * "Notable" means irreversible, outward-facing, or unusual — the entries someone
 * scanning the feed should stop on. Routine bookkeeping (a question edited, an
 * event moved) still appears, just unmarked.
 *
 * This used to be substring matching over the old free-text action sentence,
 * which quietly marked anything containing "accept" — including the *declines*
 * of a team invitation. Matching whole slugs makes the set explicit.
 */
// Typed `ReadonlySet<string>` at the boundary but built from `LogAction`: entries
// arrive from the database as plain strings, while a typo in the list below is
// still a compile error.
export const NOTABLE_ACTIONS: ReadonlySet<string> = new Set<LogAction>([
	'admissions.release',
	// One click, arbitrarily many applicants. Still reversible until release —
	// hence a dot rather than the warning tone `admissions.release` carries — but
	// it is the entry that explains why two hundred rows changed at 3am.
	'admissions.decision.bulk',
	'admissions.decision.blocked',
	'user.decision.override',
	'user.export',
	// The whole database, out the door or gone entirely. `data.wipe` is written
	// after the wipe has already emptied `Log`, so in the ordinary case it is the
	// oldest entry in the feed rather than one among many — which is precisely
	// why it needs to be marked.
	'data.export',
	'data.wipe',
	'email.custom.send',
	'blacklist.import',
	'question.delete',
	'settings.update'
]);

/**
 * Badge tone for an action slug on `/admin/logs`.
 *
 * Rodeo's palette carries one meaning — status — so this stays deliberately
 * sparse: red for the entries someone is scanning the page to find (something
 * blocked, something overridden, a list exported), amber for the irreversible
 * batch actions, and neutral for the rest. Coloring every group would turn the
 * table into a rainbow and cost the two that matter their signal.
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
