import adapter from '@sveltejs/adapter-vercel';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		// Node runtime rather than edge: every route talks to Postgres through Prisma,
		// which needs a real TCP socket.
		adapter: adapter({ runtime: 'nodejs22.x' })
	}
};

export default config;
