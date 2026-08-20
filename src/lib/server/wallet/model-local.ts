/**
 * The pass model that ships inside the bundle.
 *
 * `read()` from `$app/server`, not `fs`. `adapter-vercel` does not copy project files
 * into the function, so `fs.readFile(...)`, `process.cwd()` and
 * `new URL('./model/icon.png', import.meta.url)` all work in `vite dev` and die once
 * deployed. Vite's `?url` import makes the file a traced build artefact instead.
 *
 * The imports are written out one by one rather than globbed: a glob that matches
 * nothing is a runtime surprise, where a named import of a missing file fails the
 * build. Apple fixes the pkpass file set, so there is nothing to discover.
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
 * Apple's WWDR intermediate, vendored alongside the artwork. Public, identical for
 * every developer, and valid until 2030, so it is source rather than configuration.
 * Async only to match `loadPassModel`'s shape.
 */
export async function loadBundledWwdrCertificate(): Promise<string> {
	return APPLE_WWDR_G4_PEM;
}
