import { describe, it, expect } from 'vitest';
import { suggestLinkedField } from './suggestLinkedField';

/**
 * The chip appears unbidden beside a title someone is still typing, so these tests
 * lean on the negative cases. A missed suggestion costs one manual selection from a
 * select that is right there; a wrong one reads as the editor misunderstanding the
 * question, and "Link to Name" under "What is your team name?" is one click from
 * overwriting every applicant's name.
 */

describe('suggestLinkedField — what it proposes', () => {
	it.each([
		'What university do you attend?',
		'University',
		'Which college are you at?',
		'What school do you go to?',
		'Name of your institution',
		'Alma mater'
	])('reads %j as a University question', (title) => {
		expect(suggestLinkedField(title)).toBe('UNIVERSITY');
	});

	it.each([
		'What year are you?',
		'Year',
		'Class standing',
		'What is your grade level?',
		'Academic level',
		'Classification'
	])('reads %j as a Year question', (title) => {
		expect(suggestLinkedField(title)).toBe('YEAR');
	});

	it.each(['Full Name', 'What is your name?', 'Name'])('reads %j as a Name question', (title) => {
		expect(suggestLinkedField(title)).toBe('NAME');
	});
});

describe('suggestLinkedField — what it declines to propose', () => {
	it.each([
		'What is your team name?',
		'Project name',
		"Your group's name",
		'Event name',
		'Preferred name',
		'GitHub username',
		'What username do you want?'
	])('says nothing about %j, which is not the Name column', (title) => {
		expect(suggestLinkedField(title)).toBeNull();
	});

	it.each([
		'Graduation year',
		'What year do you graduate?',
		'Year of birth',
		'Birth year',
		'Years of experience',
		'How many years have you been coding?'
	])('says nothing about %j, which is not class standing', (title) => {
		expect(suggestLinkedField(title)).toBeNull();
	});

	it.each([
		'What is your major?',
		'Tell us about a project you are proud of',
		'Do you need travel reimbursement?',
		'T-shirt size',
		''
	])('says nothing about %j, which is nothing in particular', (title) => {
		expect(suggestLinkedField(title)).toBeNull();
	});
});

describe('suggestLinkedField — titles that could be two fields', () => {
	it('reads "What year are you in school?" as Year, not University', () => {
		// Matches both patterns. Year wins because this exact phrasing is the common
		// one, and a question about which institution rarely says "year".
		expect(suggestLinkedField('What year are you in school?')).toBe('YEAR');
	});

	it('reads "What is the name of your university?" as University, not Name', () => {
		expect(suggestLinkedField('What is the name of your university?')).toBe('UNIVERSITY');
	});

	it('lets one disqualifying phrase suppress an otherwise clean match', () => {
		// "school" alone would suggest University; "team name" vetoes the whole title
		// rather than only the Name reading, because the sentence is about a team.
		expect(suggestLinkedField('What is your team name at school?')).toBeNull();
	});
});

describe('suggestLinkedField — matching rules', () => {
	it('ignores case, since titles are written however the organizer types them', () => {
		expect(suggestLinkedField('UNIVERSITY')).toBe('UNIVERSITY');
		expect(suggestLinkedField('full name')).toBe('NAME');
	});

	it('matches whole words only', () => {
		// Otherwise "Renamed" and "Yearbook" would both trip it.
		expect(suggestLinkedField('Has this been renamed?')).toBeNull();
		expect(suggestLinkedField('Yearbook photo consent')).toBeNull();
	});
});
