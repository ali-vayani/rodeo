/**
 * The pass model that ships inside the bundle.
 *
 * ## Why `read()` and not `fs`
 *
 * This is the one part of the wallet feature that works perfectly in `vite dev`
 * and then 500s in production if written the obvious way. `adapter-vercel` emits
 * Build Output API v3 and does not copy project files into the function; it has
 * no `includeFiles` option, and `vercel.json`'s doesn't apply to it either. So
 * `fs.readFile('src/lib/server/wallet/model/icon.png')`, anything resolved from
 * `process.cwd()`, and `new URL('./model/icon.png', import.meta.url)` all survive
 * local development and die once deployed — with a stack trace pointing at a path
 * that plainly exists in the repo.
 *
 * `read()` from `$app/server` is the supported route. Vite's `?url` import makes
 * the file a build artefact the bundler knows about and traces, and `read()`
 * resolves that artefact at runtime in both dev and production.
 *
 * ## Why the imports are written out one by one
 *
 * `import.meta.glob` would be shorter and would defeat the point: a glob that
 * matches nothing is a runtime surprise, whereas a named import of a file that
 * isn't there fails the build. The pkpass file set is fixed and small — Apple
 * defines it — so there is nothing to discover and everything to pin down.
 *
 * `pass.json` is the exception: it comes in as a JSON import, so it lands in the
 * chunk as data and costs no runtime I/O at all.
 */

import { read } from '$app/server';
import passJson from './model/pass.json';
import iconUrl from './model/icon.png?url';
import icon2xUrl from './model/icon@2x.png?url';
import logoUrl from './model/logo.png?url';
import logo2xUrl from './model/logo@2x.png?url';
import stripUrl from './model/strip.png?url';
import strip2xUrl from './model/strip@2x.png?url';
import { APPLE_WWDR_G4_PEM } from './model/wwdr';
import type { PassModel } from './model';

const IMAGES: Record<string, string> = {
	'icon.png': iconUrl,
	'icon@2x.png': icon2xUrl,
	'logo.png': logoUrl,
	'logo@2x.png': logo2xUrl,
	'strip.png': stripUrl,
	'strip@2x.png': strip2xUrl
};

/** The names `loadRemotePassModel` looks for, so the two sources stay in step. */
export const MODEL_FILE_NAMES = ['pass.json', ...Object.keys(IMAGES)];

/** The bundled model. Always available — this is the fallback everything else leans on. */
export async function loadLocalPassModel(): Promise<PassModel> {
	const images = await Promise.all(
		Object.entries(IMAGES).map(
			async ([name, url]) => [name, Buffer.from(await read(url).arrayBuffer())] as const
		)
	);

	return {
		'pass.json': Buffer.from(JSON.stringify(passJson), 'utf8'),
		...Object.fromEntries(images)
	};
}

/**
 * Apple's WWDR intermediate, vendored alongside the artwork.
 *
 * Public, identical for every Apple developer, and valid until 2030 — so it is
 * part of the source rather than an environment variable. The previous Rodeo made
 * it a variable and filled it with a copy of the signer certificate, which is why
 * that setup could never have signed a pass iOS would install.
 *
 * Async only to match `loadPassModel`'s shape, so callers can await both together.
 */
export async function loadBundledWwdrCertificate(): Promise<string> {
	return APPLE_WWDR_G4_PEM;
}
