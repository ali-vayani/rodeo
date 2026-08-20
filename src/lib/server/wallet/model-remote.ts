/**
 * Pass artwork fetched from a bucket, so it can be changed without a deploy.
 *
 * Plain HTTPS `fetch`, not the AWS SDK. There are no secrets in a `.pkpass` model, so a
 * public-read bucket removes a ~20 MB dependency and a real trap: Vercel sets
 * `AWS_REGION` and the Lambda credentials itself, so an SDK on bare `AWS_*` names
 * silently uses the platform's. A private-bucket variant must namespace every variable.
 */

import { walletAssetsBaseUrl } from './config';
import { MODEL_FILE_NAMES } from './model-local';
import type { PassModel } from './model';

/** Files without which there is no pass at all. Everything else is decoration. */
const REQUIRED = new Set(['pass.json', 'icon.png']);

/**
 * How long a fetched model stays good. A warm instance serves many downloads, and
 * re-fetching seven files per click would put the bucket in every request's critical
 * path. Ten minutes still makes swapping artwork a same-morning operation.
 */
const TTL_MS = 10 * 60 * 1000;

let cache: { model: PassModel; expires: number } | null = null;

/** Drops the memo. Tests only — the TTL is what production relies on. */
export function resetRemoteModelCache(): void {
	cache = null;
}

/**
 * Fetch the model from `WALLET_ASSETS_BASE_URL`. Throws on anything that would yield a
 * partial model; `model.ts` turns that into a fall back to the bundled copy.
 */
export async function loadRemotePassModel(now: number = Date.now()): Promise<PassModel> {
	if (cache && cache.expires > now) return cache.model;

	const base = walletAssetsBaseUrl();
	if (!base) throw new Error('WALLET_ASSETS_BASE_URL is not set');

	const entries = await Promise.all(
		MODEL_FILE_NAMES.map(async (name) => {
			const response = await fetch(`${base}/${name}`);

			if (!response.ok) {
				if (REQUIRED.has(name)) {
					throw new Error(`${base}/${name} returned ${response.status}`);
				}
				// An optional image the bucket doesn't carry. The pass renders without it.
				return null;
			}

			return [name, Buffer.from(await response.arrayBuffer())] as const;
		})
	);

	const model = Object.fromEntries(entries.filter((entry) => entry !== null));
	cache = { model, expires: now + TTL_MS };
	return model;
}
