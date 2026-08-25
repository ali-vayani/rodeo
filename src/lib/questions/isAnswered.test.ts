import { describe, it, expect } from 'vitest';
import { QuestionType } from '$lib/generated/prisma/enums';
import { isAnswered } from './isAnswered';
import { encodeMultiSelect } from './multiSelect';

describe('isAnswered', () => {
	it('rejects a missing or blank value for every type', () => {
		// Autosave writes a row on the keystroke that clears a field, so row existence is
		// not an answer. This is the rule the form's counter and `submit` have to share.
		for (const type of Object.values(QuestionType)) {
			expect(isAnswered(type, undefined)).toBe(false);
			expect(isAnswered(type, '')).toBe(false);
			expect(isAnswered(type, '   ')).toBe(false);
		}
	});

	it('counts an unticked CHECKBOX as unanswered', () => {
		// The bug this rule exists for: clearing a box autosaves 'false', which is not
		// blank, so a required consent gate passed while unticked.
		expect(isAnswered(QuestionType.CHECKBOX, 'false')).toBe(false);
		expect(isAnswered(QuestionType.CHECKBOX, 'true')).toBe(true);
	});

	it('counts an empty MULTI_SELECT as unanswered', () => {
		expect(isAnswered(QuestionType.MULTI_SELECT, encodeMultiSelect([]))).toBe(false);
		expect(isAnswered(QuestionType.MULTI_SELECT, '[]')).toBe(false);
		expect(isAnswered(QuestionType.MULTI_SELECT, encodeMultiSelect(['Vegan']))).toBe(true);
	});

	it('counts an unreadable MULTI_SELECT as unanswered', () => {
		// A row left behind by switching the question's type decodes to nothing, which is
		// no more an answer than a blank.
		expect(isAnswered(QuestionType.MULTI_SELECT, 'Vegan')).toBe(false);
	});

	it('counts any non-blank text as an answer', () => {
		expect(isAnswered(QuestionType.LONG_TEXT, 'I have judged before.')).toBe(true);
		expect(isAnswered(QuestionType.NUMBER, '0')).toBe(true);
	});
});
