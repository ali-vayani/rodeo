/**
 * Where the `.pkpass` model comes from.
 *
 * Two sources behind one call: the copy bundled with the build by default, or a bucket
 * when `WALLET_ASSETS_BASE_URL` is set, so artwork can be swapped without a deploy.
 *
 * The remote source falls back to the local one on any failure. The bundled model is
 * always present, so no bucket problem should stop a confirmed attendee getting a pass.
 * A misconfigured URL costs the artwork and says so in the log.
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
