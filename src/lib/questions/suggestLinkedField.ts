/**
 * Reading a question's title and guessing which `User` column it means.
 *
 * An organizer writing "What university do you attend?" has to know two things that
 * are nowhere on screen: that a University linked field exists, and that attaching it
 * is what makes the admissions filter and the demographics chart work. Nobody knows
 * that on their first hackathon, so the seeded form is the only form that has ever had
 * its fields linked. This closes that gap by offering the link at the moment the title
 * is typed.
 *
 * A pure function, unit-tested, with the editor holding no logic of its own — the
 * repo has no component test runner, so anything worth checking lives in `$lib/*.ts`
 * (see `$lib/ui/tone`, `$lib/team/eligibility`).
 */

import type { LinkedField } from '$lib/linkedFields';

/**
 * Titles that contain a trigger word and mean something else entirely.
 *
 * Checked before the positive patterns and applied to the whole title, so one
 * disqualifying phrase suppresses the suggestion outright. That asymmetry is
 * deliberate: this is a chip that appears unbidden next to what someone is typing, so
 * a wrong guess costs more than a missed one. "What is your team name?" offering to
 * write the answer into `User.name` is the failure to avoid — it reads as the editor
 * misunderstanding the question, and it is one careless click from corrupting every
 * applicant's name.
 *
 * Graduation year is on the list because it is a genuinely different datum from class
 * standing: `2027` and `Junior` are both answers to "year", and only the second is
 * what the Year field holds.
 */
const DISQUALIFIERS = [
	/\b(team|project|group|event|company|file|user|middle|preferred|legal|display)['’]?s?\s+name\b/i,
	/\busernames?\b/i,
	/\b(graduation|grad|birth)\s+year\b/i,
	/\byear\s+of\s+(birth|graduation)\b/i,
	// "What year do you graduate?", "What year are you graduating?" — the same datum as
	// "graduation year", asked the long way round.
	/\byear\b[^?.]*\bgraduat(e|es|ing|ion)\b/i,
	/\byears?\s+of\s+experience\b/i,
	/\bhow\s+many\s+years\b/i
];

/**
 * What each field looks like when someone asks for it. First match wins.
 *
 * The order resolves two real collisions:
 *
 *   - **Year before University**, because "What year are you in school?" matches both
 *     and means the first. The reverse ordering gets that extremely common phrasing
 *     wrong, and the title it costs — something like "which college are you attending
 *     this year" — is not a form field anyone writes.
 *   - **Name last**, because `\bname\b` is the loosest pattern here and "What is the
 *     name of your university?" is a University question.
 *
 * `school` lives under University rather than getting a field of its own: a hackathon
 * that admits high schoolers still wants one column for where somebody studies.
 */
const PATTERNS: [LinkedField, RegExp][] = [
	['YEAR', /\b(year|grade\s+level|classification|class\s+standing|academic\s+level)\b/i],
	['UNIVERSITY', /\b(universit(y|ies)|college|school|institution|alma\s+mater)\b/i],
	['NAME', /\bname\b/i]
];

/**
 * The linked field a question title is asking for, or `null` when it isn't obvious.
 *
 * Only ever a suggestion. Nothing here decides what a question is linked to — the
 * organizer does, and can attach a field this never proposes.
 */
export function suggestLinkedField(title: string): LinkedField | null {
	if (DISQUALIFIERS.some((pattern) => pattern.test(title))) return null;

	for (const [field, pattern] of PATTERNS) {
		if (pattern.test(title)) return field;
	}
	return null;
}
