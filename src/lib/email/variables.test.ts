import { describe, it, expect } from 'vitest';
import {
	TEMPLATE_VARIABLES,
	VARIABLE_KEYS,
	RAW_VARIABLE_KEYS,
	SAMPLE_VARS,
	substituteVariables,
	tokenizeTemplate,
	buildTemplateVars,
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
			{ type: 'known', value: 'Sarah Chen', key: 'name' },
			{ type: 'text', value: ', ' },
			{ type: 'unknown', value: '{{bogus}}', key: 'bogus' },
			{ type: 'text', value: ' bye' }
		]);
	});

	it('emits no empty text segments around edge-anchored variables', () => {
		expect(tokenizeTemplate('{{name}}')).toEqual([
			{ type: 'known', value: 'Sarah Chen', key: 'name' }
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
			rsvp_deadline: new Date(2026, 3, 1).toLocaleDateString(),
			// Empty unless a caller supplies the block: this module cannot build it
			// (Prisma, a QR encoder, and an attachment are all out of bounds here), and
			// empty is also the right value for a recipient with no pass to show.
			check_in_pass: ''
		});
	});

	it('carries a supplied check-in block through', () => {
		const vars = buildTemplateVars(
			{ name: 'Sarah Chen' },
			{ hackathonStartDate: new Date(2026, 3, 15), RSVPDeadline: new Date(2026, 3, 1) },
			'<table>qr</table>'
		);
		expect(vars.check_in_pass).toBe('<table>qr</table>');
	});
});

describe('raw block variables', () => {
	const vars = { name: '<b>Sarah</b>', check_in_pass: '<table>qr</table>' };

	it('is not escaped in a body, unlike every other value', () => {
		// Escaping it would mail the hacker the HTML source of their own QR code,
		// while `name` still has to be escaped because an applicant sets it.
		const out = substituteVariables('{{name}} {{check_in_pass}}', vars, { escapeValues: true });
		expect(out).toBe('&lt;b&gt;Sarah&lt;/b&gt; <table>qr</table>');
	});

	it('is dropped from a subject', () => {
		// The editor's chips can insert into the subject field, and a subject is
		// plain text — raw markup there would mail out a subject full of `<table>`.
		const out = substituteVariables('Welcome {{name}}{{check_in_pass}}', vars, {
			dropRawValues: true
		});
		expect(out).toBe('Welcome <b>Sarah</b>');
	});

	it('declares every raw key as a real variable', () => {
		for (const key of RAW_VARIABLE_KEYS) expect(VARIABLE_KEYS).toContain(key);
	});
});
