import type { Project } from './types';

/**
 * Case-insensitive match on name, description, or table number, and the list sorted
 * by table so the page reads the way the room is laid out.
 */
export function filterProjects(projects: Project[], query: string): Project[] {
	const q = query.trim().toLowerCase();
	const matches = q
		? projects.filter(
				(p) =>
					p.name.toLowerCase().includes(q) ||
					p.description.toLowerCase().includes(q) ||
					String(p.table) === q
			)
		: projects;
	return [...matches].sort((a, b) => a.table - b.table);
}
