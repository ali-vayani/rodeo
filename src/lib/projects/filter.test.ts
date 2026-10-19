import { describe, it, expect } from 'vitest';
import { filterProjects } from './filter';

const projects = [
	{ name: 'GooseRoute', table: 4, description: 'Trip planning.' },
	{ name: 'Food Finder', table: 6, description: 'Free food around Austin.' },
	{ name: 'Waddle', table: 1, description: 'A knee tracker.' }
];

describe('filterProjects', () => {
	it('sorts by table when the query is empty', () => {
		expect(filterProjects(projects, '').map((p) => p.table)).toEqual([1, 4, 6]);
	});

	it('matches name and description case-insensitively', () => {
		expect(filterProjects(projects, 'FOOD').map((p) => p.name)).toEqual(['Food Finder']);
		expect(filterProjects(projects, 'knee').map((p) => p.name)).toEqual(['Waddle']);
	});

	it('matches an exact table number', () => {
		expect(filterProjects(projects, '4').map((p) => p.name)).toEqual(['GooseRoute']);
		expect(filterProjects(projects, '40')).toEqual([]);
	});
});
