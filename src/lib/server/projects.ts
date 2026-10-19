import { projectsFeedSchema, type Project } from '$lib/projects/types';

export type ProjectsResult = { projects: Project[]; error: null } | { projects: []; error: string };

/**
 * Pulls the projects feed on the server, so the URL stays private and the browser
 * never has to care about CORS. A bad feed is reported, not thrown: the page still
 * renders and tells the reader the list could not be loaded.
 */
export async function fetchProjects(url: string | null): Promise<ProjectsResult> {
	if (!url) return { projects: [], error: 'No projects feed URL is set in Settings.' };
	try {
		const response = await fetch(url, {
			headers: { accept: 'application/json' },
			signal: AbortSignal.timeout(5000)
		});
		if (!response.ok) {
			return { projects: [], error: `The projects feed answered ${response.status}.` };
		}
		const parsed = projectsFeedSchema.safeParse(await response.json());
		if (!parsed.success) {
			return { projects: [], error: 'The projects feed is not in the expected shape.' };
		}
		return { projects: parsed.data, error: null };
	} catch (cause) {
		console.error('projects feed fetch failed', cause);
		return { projects: [], error: 'The projects feed could not be reached.' };
	}
}
