/**
 * Whether a stored response counts as an answer to a required question.
 *
 * Shared by `application.submit` and the form's progress counter on purpose. The page
 * used to apply its own "non-blank" rule, so an unticked required consent box — which
 * autosaves the non-blank string 'false' — read as answered, showed 21/21, and was then
 * refused by submit with a message naming a question the applicant could see they had
 * filled in.
 */

import type { QuestionType } from '$lib/generated/prisma/client';
import { decodeMultiSelect } from './multiSelect';

/**
 * A blank value never counts: autosave writes a row as soon as a field is touched, so
 * presence of the row let an applicant satisfy every required question by saving "".
 *
 * A CHECKBOX needs the second clause. Clearing one autosaves the string 'false', which
 * is not blank — so the required consent boxes (MLH data sharing, code of conduct, food
 * allergy waiver) passed submit while unticked, which is the opposite of what a consent
 * gate is for.
 *
 * A MULTI_SELECT clears to '' and so is already caught above; the third clause is for
 * an unreadable value, which is no more an answer than a blank one.
 */
export function isAnswered(type: QuestionType, value: string | undefined): boolean {
	if (value === undefined || value.trim() === '') return false;
	if (type === 'CHECKBOX') return value === 'true';
	if (type === 'MULTI_SELECT') return decodeMultiSelect(value).length > 0;
	return true;
}
