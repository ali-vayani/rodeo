import { describe, it, expect } from 'vitest';
import { LINKED_FIELDS } from '$lib/linkedFields';
import { LINKED_FIELD_DEFAULTS, YEAR_OPTIONS, defaultsFor } from './linkedFieldDefaults';
import { isOptionsType } from './options';

describe('linked field defaults', () => {
	it('has a default for every linked field', () => {
		// A field with no entry would attach silently and change nothing, which reads as
		// the editor ignoring the click.
		expect(Object.keys(LINKED_FIELD_DEFAULTS).sort()).toEqual([...LINKED_FIELDS].sort());
	});

	it('collects a name as one line of text', () => {
		expect(defaultsFor('NAME')).toEqual({
			type: 'SHORT_TEXT',
			options: [],
			optionPreset: null
		});
	});

	it('collects a year as a dropdown over the class standings', () => {
		expect(defaultsFor('YEAR')).toEqual({
			type: 'DROPDOWN',
			options: ['Freshman', 'Sophomore', 'Junior', 'Senior', 'Graduate', 'Alumni'],
			optionPreset: null
		});
	});

	it('collects a university from the preset, with no hand-authored options', () => {
		expect(defaultsFor('UNIVERSITY')).toEqual({
			type: 'DROPDOWN',
			options: [],
			optionPreset: 'UNIVERSITIES_NA'
		});
	});

	it('only ever presets a type that offers choices', () => {
		// `hasPresetOptions` ignores a preset on a free-text question, so a default that
		// paired the two would produce a question whose options went nowhere.
		for (const field of LINKED_FIELDS) {
			const defaults = defaultsFor(field);
			if (defaults.optionPreset !== null) expect(isOptionsType(defaults.type)).toBe(true);
		}
	});

	it('hands out a fresh array each time', () => {
		// The editor binds this straight to its options state and lets the organizer edit
		// it. Sharing the array would edit the default for every question after it.
		const first = defaultsFor('YEAR');
		first.options.push('Postdoc');
		expect(defaultsFor('YEAR').options).toEqual([...YEAR_OPTIONS]);
	});
});
