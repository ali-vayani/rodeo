/**
 * How a MULTI_SELECT answer is packed into the one `ApplicationResponse.value` string.
 *
 * Every other answer type is a single value, so rather than add a column the chosen
 * options are stored as a JSON array. JSON rather than a delimited list because option
 * text is organizer-authored: any separator we picked could appear inside an option.
 *
 * The renderer, the editor's preview, `assertAnswerValid`, the facet builder, the
 * filter predicate and the admissions detail all decode through here, so they cannot
 * disagree about what an answer means.
 */

/**
 * The stored form of a selection.
 *
 * An empty selection is `''`, not `'[]'`, so the "blank means unanswered" rule that
 * `isAnswered`, the facet `noneCount` and the submit gate already share keeps working
 * without any of them learning about this encoding.
 */
export function encodeMultiSelect(values: string[]): string {
	return values.length ? JSON.stringify(values) : '';
}

/**
 * The chosen options, or `[]` for anything that isn't a selection.
 *
 * Tolerant on purpose: this reads rows written before the question was switched to
 * MULTI_SELECT, and an old single-select answer or a hand-edited row must render as an
 * empty selection rather than throw in the middle of an admissions list.
 */
export function decodeMultiSelect(value: string): string[] {
	if (value.trim() === '') return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) return [];
	return parsed as string[];
}

/**
 * Splits a decoded answer into the offered options it holds and the write-in, if any.
 *
 * A write-in is stored as an ordinary member rather than under a marker, so it is
 * simply the member that isn't in `options`. That is what lets the facet builder count
 * it beside the declared options and the filter predicate match it unchanged.
 *
 * At most one, because the form offers one "Other" box. A payload carrying several is
 * kept as its first, and `assertAnswerValid` rejects it outright — this function is
 * what the renderer uses to display an answer, and it has one box to put it in.
 */
export function splitWriteIn(
	chosen: string[],
	options: string[]
): { selected: string[]; writeIn: string | null } {
	const declared = new Set(options);
	return {
		selected: chosen.filter((value) => declared.has(value)),
		writeIn: chosen.find((value) => !declared.has(value)) ?? null
	};
}

/**
 * One option as it appears inside an encoded answer.
 *
 * The filter predicate matches a selected option as a substring of the stored array,
 * since Postgres can't index into a `text` column holding JSON. Quoted, so `"Go"`
 * cannot match the answer `["Golang"]`.
 */
export function encodeMultiSelectMember(value: string): string {
	return JSON.stringify(value);
}
