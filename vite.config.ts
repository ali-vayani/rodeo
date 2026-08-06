import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

/**
 * Keep the dev-only account switcher out of production builds.
 *
 * `src/routes/+layout.svelte` already guards it with `{#if dev}` and a dynamic
 * import, and Rollup does fold that branch away — nothing in a built bundle imports
 * the component. But folding the *reference* is not the same as dropping the
 * *chunk*: the module graph is walked before dead-code elimination runs, so
 * `vite build` still wrote an 11.7 KB orphan to `_app/immutable/chunks/` and listed
 * it in the Vite manifest. Unreachable, but served to anyone who asks for it by name.
 *
 * Emptying the modules at load time is what makes "absent in production" true rather
 * than merely intended. `apply: 'build'` leaves `vite dev` — the only place the
 * feature is supposed to work — completely untouched.
 *
 * The matching server route guards itself at runtime instead (see
 * `src/routes/dev/accounts/+server.ts`), because that gate is unit-tested and a stub
 * would replace the thing the tests cover.
 */
function excludeDevOnlyClientCode() {
	const DEV_ONLY = /[\\/]src[\\/]lib[\\/]dev[\\/]/;
	return {
		name: 'rodeo-exclude-dev-only',
		apply: 'build' as const,
		enforce: 'pre' as const,
		load(id: string) {
			if (!DEV_ONLY.test(id)) return null;
			// A comment is a valid empty Svelte component; everything else is a module
			// with nothing in it. Either way the chunk has no body to emit.
			return id.endsWith('.svelte') ? '<!-- dev-only: excluded from this build -->' : 'export {};';
		}
	};
}

export default defineConfig({
	plugins: [tailwindcss(), sveltekit(), excludeDevOnlyClientCode()],
	ssr: {
		external: ['pg']
	},
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
