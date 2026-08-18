/**
 * Where the `.pkpass` model comes from.
 *
 * Two sources behind one call. Locally, and by default, the copy bundled with the
 * build; in production with `WALLET_ASSETS_BASE_URL` set, a bucket, so artwork can
 * be swapped without a deploy.
 *
 * The remote source falls back to the local one on any failure. That asymmetry is
 * deliberate: the bundled model is always present, so there is no scenario in
 * which a bucket problem should stop a confirmed attendee getting a pass. A
 * misconfigured URL costs the artwork and nothing else, and says so in the log.
 */

import { passAssetSource } from './config';
import { loadLocalPassModel } from './model-local';
import { loadRemotePassModel } from './model-remote';

/** File name to bytes, the shape `passkit-generator` takes as a model. */
export type PassModel = Record<string, Buffer>;

export async function loadPassModel(): Promise<PassModel> {
	if (passAssetSource() === 'local') return await loadLocalPassModel();

	try {
		return await loadRemotePassModel();
	} catch (error) {
		console.warn(`[wallet] Falling back to the bundled pass model: ${(error as Error).message}`);
		return await loadLocalPassModel();
	}
}
