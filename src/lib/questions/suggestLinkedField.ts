/**
 * Guessing which `User` column a question title means, so the editor can offer the
 * link at the moment the title is typed. Pure and unit-tested; the editor holds no
 * logic of its own.
 */

import type { LinkedField } from '$lib/linkedFields';

/**
 * Titles that contain a trigger word and mean something else entirely.
 *
 * Checked before the positive patterns and applied to the whole title, so one
 * disqualifying phrase suppresses the suggestion. A wrong guess costs more than a
 * missed one: "What is your team name?" offering to write into `User.name` is one
 * click from corrupting every applicant's name.
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
 * Year before University, because "What year are you in school?" matches both and means
 * the first. Name last, because `\bname\b` is the loosest pattern here.
 */
const PATTERNS: [LinkedField, RegExp][] = [
	['YEAR', /\b(year|grade\s+level|classification|class\s+standing|academic\s+level)\b/i],
	['UNIVERSITY', /\b(universit(y|ies)|college|school|institution|alma\s+mater)\b/i],
	['NAME', /\bname\b/i]
];

/** The linked field a title is asking for, or `null`. Only ever a suggestion. */
export function suggestLinkedField(title: string): LinkedField | null {
	if (DISQUALIFIERS.some((pattern) => pattern.test(title))) return null;

	for (const [field, pattern] of PATTERNS) {
		if (pattern.test(title)) return field;
	}
	return null;
}
