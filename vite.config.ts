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
			// Preview builds keep the switcher — it is enabled there (see
			// devSwitcherEnabled in src/lib/server/env.ts). Only a production
			// build empties the modules. VERCEL_ENV is present at build time on
			// Vercel; a local `vite build` keeps the code and relies on the
			// runtime gates, same as preview.
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
		 * Vite inlines imported assets under 4 kB as `data:` URIs, and `read()` from
		 * `$app/server` handles those — so the placeholder artwork currently in
		 * `src/lib/server/wallet/model/` works without any of this. The moment someone
		 * replaces it with real logo and strip images it crosses the threshold, Vite
		 * emits real files instead, and the code path changes from "decode a string in
		 * the bundle" to "resolve a traced server asset". A build-time cliff triggered
		 * by a designer handing over a PNG is not a thing anyone would think to test.
		 *
		 * Forcing the emitted-file path means placeholders and real artwork exercise
		 * exactly the same mechanism, and `npm run build` proves it either way.
		 */
		assetsInlineLimit: (filePath: string) =>
			/[\\/]src[\\/]lib[\\/]server[\\/]wallet[\\/]model[\\/]/.test(filePath) ? false : undefined
	},
	ssr: {
		// Left for Node to resolve at runtime rather than bundled. `pg` has always been
		// here; the two wallet packages join it because Rollup mangles them:
		// `passkit-generator` pulls in node-forge and joi, both of which reach for CJS
		// interop the SSR bundler gets wrong, and `google-auth-library` ships no
		// `exports` field for it to follow.
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
