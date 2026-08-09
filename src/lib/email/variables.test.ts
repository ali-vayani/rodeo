import { describe, it, expect } from 'vitest';
import {
	TEMPLATE_VARIABLES,
	VARIABLE_KEYS,
	SAMPLE_VARS,
	substituteVariables,
	tokenizeTemplate,
	buildTemplateVars,
	buildEventVars,
	buildExternalTemplateVars,
	EXTERNAL_NAME_FALLBACK,
	type TemplateSegment
} from './variables';

/** Reconstruct the original template from its segments. */
function source(segments: TemplateSegment[]): string {
	return segments.map((s) => (s.type === 'text' ? s.value : `{{${s.key}}}`)).join('');
}

describe('substituteVariables', () => {
	it('replaces a known variable', () => {
		expect(substituteVariables('Hi {{name}}!', { name: 'Sarah' })).toBe('Hi Sarah!');
	});

	it('replaces every occurrence of a repeated variable', () => {
		expect(substituteVariables('{{name}} and {{name}}', { name: 'Sarah' })).toBe('Sarah and Sarah');
	});

	it('handles adjacent variables with no separator', () => {
		expect(substituteVariables('{{a}}{{b}}', { a: '1', b: '2' })).toBe('12');
	});

	it('leaves unknown variables literal', () => {
		// The preview relies on this: an unsubstituted {{foo}} must stay visible
		// rather than collapsing to an empty string.
		expect(substituteVariables('Hi {{foo}}', { name: 'Sarah' })).toBe('Hi {{foo}}');
	});

	it('returns an empty string unchanged', () => {
		expect(substituteVariables('', SAMPLE_VARS)).toBe('');
	});

	it('ignores malformed placeholders', () => {
		expect(substituteVariables('{{ name }} {name} {{na-me}}', { name: 'Sarah' })).toBe(
			'{{ name }} {name} {{na-me}}'
		);
	});
});

describe('tokenizeTemplate', () => {
	it('classifies text, known and unknown segments in order', () => {
		expect(tokenizeTemplate('Hi {{name}}, {{bogus}} bye')).toEqual([
			{ type: 'text', value: 'Hi ' },
			// Read off SAMPLE_VARS rather than hardcoded: this asserts that the default
			// substitution happens, not what the placeholder currently reads.
			{ type: 'known', value: SAMPLE_VARS.name, key: 'name' },
			{ type: 'text', value: ', ' },
			{ type: 'unknown', value: '{{bogus}}', key: 'bogus' },
			{ type: 'text', value: ' bye' }
		]);
	});

	it('emits no empty text segments around edge-anchored variables', () => {
		expect(tokenizeTemplate('{{name}}')).toEqual([
			{ type: 'known', value: SAMPLE_VARS.name, key: 'name' }
		]);
	});

	it('returns an empty array for an empty template', () => {
		expect(tokenizeTemplate('')).toEqual([]);
	});

	it('round-trips: segment sources concatenate back to the input', () => {
		const input = 'Hi {{name}},\n\nRSVP by {{rsvp_deadline}} — {{bogus}}{{name}}\n';
		expect(source(tokenizeTemplate(input))).toBe(input);
	});

	it('is re-runnable despite the shared global regex', () => {
		// Guards against a stale lastIndex leaking between calls.
		const input = 'a {{name}} b';
		expect(tokenizeTemplate(input)).toEqual(tokenizeTemplate(input));
	});

	it('accepts a custom variable map', () => {
		expect(tokenizeTemplate('{{name}}', { name: 'Ada' })).toEqual([
			{ type: 'known', value: 'Ada', key: 'name' }
		]);
	});
});

describe('variable definitions', () => {
	it('has a sample for every declared variable', () => {
		expect(Object.keys(SAMPLE_VARS).sort()).toEqual([...VARIABLE_KEYS].sort());
	});

	it('declares no duplicate keys', () => {
		expect(new Set(VARIABLE_KEYS).size).toBe(TEMPLATE_VARIABLES.length);
	});

	it('produces exactly the advertised variables at send time', () => {
		// The contract that keeps the editor's hint list honest: anything listed in
		// TEMPLATE_VARIABLES must actually be substituted when mail goes out.
		const vars = buildTemplateVars(
			{ name: 'Sarah Chen' },
			{ hackathonStartDate: new Date('2026-04-15'), RSVPDeadline: new Date('2026-04-01') }
		);
		expect(Object.keys(vars).sort()).toEqual([...VARIABLE_KEYS].sort());
	});

	it('leaves no placeholder unsubstituted when every variable is used', () => {
		const template = VARIABLE_KEYS.map((k) => `{{${k}}}`).join(' ');
		const vars = buildTemplateVars(
			{ name: 'Sarah Chen' },
			{ hackathonStartDate: new Date('2026-04-15'), RSVPDeadline: new Date('2026-04-01') }
		);
		expect(substituteVariables(template, vars)).not.toMatch(/\{\{/);
	});
});

describe('buildTemplateVars', () => {
	it('maps user and settings onto the variable keys', () => {
		const vars = buildTemplateVars(
			{ name: 'Sarah Chen' },
			{ hackathonStartDate: new Date(2026, 3, 15), RSVPDeadline: new Date(2026, 3, 1) }
		);
		expect(vars).toEqual({
			name: 'Sarah Chen',
			hackathon_start: new Date(2026, 3, 15).toLocaleDateString(),
			rsvp_deadline: new Date(2026, 3, 1).toLocaleDateString()
		});
	});
});

describe('buildEventVars / buildExternalTemplateVars', () => {
	const settings = {
		hackathonStartDate: new Date(2026, 3, 15),
		RSVPDeadline: new Date(2026, 3, 1)
	};

	it('carries everything except the recipient-dependent name', () => {
		// This is what the server hands the compose preview, so the browser never
		// re-formats a date in its own locale.
		const vars = buildEventVars(settings);
		expect(Object.keys(vars).sort()).toEqual([...VARIABLE_KEYS].filter((k) => k !== 'name').sort());
	});

	it('substitutes the nameless fallback for a recipient with no account', () => {
		expect(buildExternalTemplateVars(settings).name).toBe(EXTERNAL_NAME_FALLBACK);
	});

	it('reads as a sentence in the salutation it has to survive', () => {
		// "Hi there," is the whole reason the fallback is a filler and not a name.
		expect(substituteVariables('Hi {{name}},', buildExternalTemplateVars(settings))).toBe(
			'Hi there,'
		);
	});

	it('gives an external recipient the same dates as a user', () => {
		const user = buildTemplateVars({ name: 'Sarah Chen' }, settings);
		const external = buildExternalTemplateVars(settings);
		expect(external.hackathon_start).toBe(user.hackathon_start);
		expect(external.rsvp_deadline).toBe(user.rsvp_deadline);
	});

	it('leaves no placeholder unsubstituted for an external recipient', () => {
		// The preview shows exactly this map, so a gap here would be a preview that
		// disagrees with the inbox.
		const template = VARIABLE_KEYS.map((k) => `{{${k}}}`).join(' ');
		expect(substituteVariables(template, buildExternalTemplateVars(settings))).not.toMatch(/\{\{/);
	});
});
