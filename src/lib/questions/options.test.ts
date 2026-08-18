import { describe, it, expect } from 'vitest';
import type { QuestionType } from '$lib/generated/prisma/client';
import { acceptsWriteIn, hasPresetOptions, isOptionsType } from './options';

const ALL_TYPES: QuestionType[] = [
	'MULTIPLE_CHOICE',
	'DROPDOWN',
	'DROPDOWN',
	'NUMBER',
	'CHECKBOX',
	'SHORT_TEXT',
	'LONG_TEXT'
];

describe('isOptionsType', () => {
	it('is true for exactly the three types that enumerate their answers', () => {
		expect(ALL_TYPES.filter(isOptionsType)).toEqual(['MULTIPLE_CHOICE', 'DROPDOWN', 'DROPDOWN']);
	});
});

describe('hasPresetOptions', () => {
	it('is true for an options question carrying a preset', () => {
		expect(hasPresetOptions({ type: 'DROPDOWN', optionPreset: 'UNIVERSITIES_NA' })).toBe(true);
	});

	it('is false without a preset', () => {
		expect(hasPresetOptions({ type: 'DROPDOWN', optionPreset: null })).toBe(false);
	});

	it('ignores a preset stranded on a free-text question', () => {
		// Switching a linked University question to Short Text leaves the column set until
		// the editor saves. Until then the preset must not apply, or `acceptsWriteIn` would
		// wave through answers to a question that no longer offers choices.
		expect(hasPresetOptions({ type: 'SHORT_TEXT', optionPreset: 'UNIVERSITIES_NA' })).toBe(false);
	});

	it('treats a missing column as no preset, not as a preset', () => {
		// A caller with a narrower select leaves the field `undefined`. Reading that as
		// "has a preset" would take a hand-authored dropdown out of the membership check
		// in `assertAnswerValid` — the check failing open.
		expect(hasPresetOptions({ type: 'DROPDOWN' } as never)).toBe(false);
	});
});

describe('acceptsWriteIn', () => {
	it('lets a preset-backed question take an answer outside its list', () => {
		// The university preset is 6,447 institutions, which is not all of them. Rejecting
		// the rest would hard-block those applicants over a gap in a third-party dataset.
		expect(acceptsWriteIn({ type: 'DROPDOWN', optionPreset: 'UNIVERSITIES_NA' })).toBe(true);
	});

	it('keeps a hand-authored list strict', () => {
		// An organizer who typed four choices meant exactly those four.
		expect(acceptsWriteIn({ type: 'DROPDOWN', optionPreset: null })).toBe(false);
		expect(acceptsWriteIn({ type: 'DROPDOWN', optionPreset: null })).toBe(false);
	});
});
