/**
 * Pass artwork fetched from a bucket, so it can be changed without a deploy.
 *
 * Plain HTTPS `fetch`, not the AWS SDK. The previous Rodeo used
 * `@aws-sdk/client-s3` with `ListObjectsV2` to discover the files and `GetObject`
 * to read them, which bought two things we don't need: discovery of a file set
 * Apple already fixes, and authentication for content that is a logo and a
 * template. There are no secrets in a `.pkpass` model. A public-read bucket or a
 * CDN in front of one removes a ~20 MB dependency whose dynamic requires are a
 * known adapter-vercel bundling hazard.
 *
 * It also removes a subtler trap. Vercel's Node runtime sets `AWS_REGION` and the
 * Lambda credential variables itself, so an SDK configured from bare `AWS_*`
 * names — as the old code was — silently picks up the platform's region and
 * credential chain instead of the ones you meant. Any future private-bucket
 * variant must namespace every variable as `WALLET_ASSETS_S3_*`; keep this
 * module's interface identical and that swap stays one file.
 */

import { walletAssetsBaseUrl } from './config';
import { MODEL_FILE_NAMES } from './model-local';
import type { PassModel } from './model';

/** Files without which there is no pass at all. Everything else is decoration. */
const REQUIRED = new Set(['pass.json', 'icon.png']);

/**
 * How long a fetched model stays good.
 *
 * A warm serverless instance serves many downloads, and re-fetching seven files
 * per click would put the bucket in the critical path of every request. Ten
 * minutes is short enough that swapping artwork mid-event is still a
 * same-morning operation.
 */
const TTL_MS = 10 * 60 * 1000;

let cache: { model: PassModel; expires: number } | null = null;

/** Drops the memo. Tests only — the TTL is what production relies on. */
export function resetRemoteModelCache(): void {
	cache = null;
}

/**
 * Fetch the model from `WALLET_ASSETS_BASE_URL`.
 *
 * Throws on anything that would yield a partial model. The caller in `model.ts`
 * turns that into a fall back to the bundled copy, which is the whole reason this
 * is allowed to fail loudly: a bad URL should cost the artwork, never the feature.
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
