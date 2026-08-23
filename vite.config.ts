import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

/**
 * Keep the dev-only account switcher out of production builds.
 *
 * The layout already guards it with `{#if dev}` and a dynamic import, but folding the
 * reference is not the same as dropping the chunk: the module graph is walked before
 * dead-code elimination, so `vite build` still wrote an 11.7 KB orphan and listed it in
 * the manifest. Emptying the modules at load time is what makes "absent in production"
 * true. The matching server route guards itself at runtime, since that gate is tested.
 *
 * Outputs:
 * - Plugin — a `pre` build-only plugin that empties every module under src/lib/dev/
 */
function excludeDevOnlyClientCode() {
	const DEV_ONLY = /[\\/]src[\\/]lib[\\/]dev[\\/]/;
	return {
		name: 'rodeo-exclude-dev-only',
		apply: 'build' as const,
		enforce: 'pre' as const,
		load(id: string) {
			if (!DEV_ONLY.test(id)) return null;
			// Preview builds keep the switcher, since it is enabled there. Only a production
			// build empties the modules. VERCEL_ENV is present at build time on Vercel; a local
			// `vite build` keeps the code and relies on the runtime gates.
			if (process.env.VERCEL_ENV !== 'production') return null;
			// A comment is a valid empty Svelte component; everything else is a module
			// with nothing in it. Either way the chunk has no body to emit.
			return id.endsWith('.svelte') ? '<!-- dev-only: excluded from this build -->' : 'export {};';
		}
	};
}

export default defineConfig({
	plugins: [tailwindcss(), sveltekit(), excludeDevOnlyClientCode()],
	build: {
		/**
		 * Never inline the wallet pass model.
		 *
		 * Vite inlines assets under 4 kB as `data:` URIs, so replacing the placeholder artwork
		 * with real images would silently switch the code path from "decode a string in the
		 * bundle" to "resolve a traced server asset". Forcing the emitted-file path means
		 * placeholders and real artwork exercise the same mechanism.
		 */
		assetsInlineLimit: (filePath: string) =>
			/[\\/]src[\\/]lib[\\/]server[\\/]wallet[\\/]model[\\/]/.test(filePath) ? false : undefined
	},
	ssr: {
		// Left for Node to resolve at runtime rather than bundled. `pg` has always been here;
		// the two wallet packages join it because Rollup mangles them. `passkit-generator`
		// pulls in node-forge and joi, whose CJS interop the SSR bundler gets wrong, and
		// `google-auth-library` ships no `exports` field for it to follow.
		external: ['pg', 'passkit-generator', 'google-auth-library']
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
