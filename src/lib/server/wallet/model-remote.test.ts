import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));
vi.mock('$app/environment', () => ({ dev: true }));

// `model-local` reaches for `$app/server`, which only exists inside a SvelteKit
// build. This module only imports it for the file-name list, so a stub is enough.
vi.mock('./model-local', () => ({
	MODEL_FILE_NAMES: [
		'pass.json',
		'icon.png',
		'icon@2x.png',
		'logo.png',
		'logo@2x.png',
		'strip.png',
		'strip@2x.png'
	],
	loadLocalPassModel: vi.fn(async () => ({ 'pass.json': Buffer.from('{"local":true}') }))
}));

const { loadRemotePassModel, resetRemoteModelCache } = await import('./model-remote');
const { loadPassModel } = await import('./model');
const { loadLocalPassModel } = await import('./model-local');

const BASE = 'https://assets.example.com/ticket.pass';

/** A fetch that returns `bytes` for every listed name and 404s for the rest. */
function stubFetch(available: string[]) {
	const fetchMock = vi.fn(async (url: string) => {
		const name = url.slice(BASE.length + 1);
		if (!available.includes(name)) return new Response(null, { status: 404 });
		return new Response(new TextEncoder().encode(`remote:${name}`), { status: 200 });
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

const ALL = [
	'pass.json',
	'icon.png',
	'icon@2x.png',
	'logo.png',
	'logo@2x.png',
	'strip.png',
	'strip@2x.png'
];

beforeEach(() => {
	for (const key of Object.keys(env)) delete env[key];
	env.WALLET_ASSETS_BASE_URL = BASE;
	resetRemoteModelCache();
	vi.mocked(loadLocalPassModel).mockClear();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('loadRemotePassModel', () => {
	it('fetches every model file from the base URL', async () => {
		const fetchMock = stubFetch(ALL);
		const model = await loadRemotePassModel();

		expect(Object.keys(model).sort()).toEqual([...ALL].sort());
		expect(model['icon.png'].toString()).toBe('remote:icon.png');
		expect(fetchMock).toHaveBeenCalledWith(`${BASE}/pass.json`);
	});

	it('tolerates a missing optional image', async () => {
		// A bucket that carries no strip art still yields a usable pass.
		stubFetch(ALL.filter((name) => !name.startsWith('strip')));
		const model = await loadRemotePassModel();

		expect(model['strip.png']).toBeUndefined();
		expect(model['icon.png']).toBeDefined();
	});

	it.each(['pass.json', 'icon.png'])('throws when the required %s is missing', async (name) => {
		// Apple silently refuses to install a pass with no icon, so a bucket missing
		// one must not be treated as a partial success.
		stubFetch(ALL.filter((file) => file !== name));
		await expect(loadRemotePassModel()).rejects.toThrow(/404/);
	});

	it('throws when no base URL is configured', async () => {
		delete env.WALLET_ASSETS_BASE_URL;
		stubFetch(ALL);
		await expect(loadRemotePassModel()).rejects.toThrow(/WALLET_ASSETS_BASE_URL/);
	});

	it('memoises so a warm instance does not refetch on every download', async () => {
		const fetchMock = stubFetch(ALL);
		await loadRemotePassModel(0);
		await loadRemotePassModel(1000);

		expect(fetchMock).toHaveBeenCalledTimes(ALL.length);
	});

	it('refetches once the TTL has passed', async () => {
		const fetchMock = stubFetch(ALL);
		await loadRemotePassModel(0);
		await loadRemotePassModel(11 * 60 * 1000);

		expect(fetchMock).toHaveBeenCalledTimes(ALL.length * 2);
	});
});

describe('loadPassModel', () => {
	it('uses the bundled model when the source is local', async () => {
		delete env.WALLET_ASSETS_BASE_URL;
		const fetchMock = stubFetch(ALL);

		expect(await loadPassModel()).toEqual({ 'pass.json': Buffer.from('{"local":true}') });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('uses the bucket when the source is remote', async () => {
		env.WALLET_ASSETS_SOURCE = 'remote';
		stubFetch(ALL);

		expect((await loadPassModel())['icon.png'].toString()).toBe('remote:icon.png');
		expect(loadLocalPassModel).not.toHaveBeenCalled();
	});

	it('falls back to the bundled model when the bucket fails', async () => {
		// The asymmetry that matters: the bundled copy is always present, so a bad
		// URL costs the artwork and never a confirmed attendee's pass.
		env.WALLET_ASSETS_SOURCE = 'remote';
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('ENOTFOUND');
			})
		);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		expect(await loadPassModel()).toEqual({ 'pass.json': Buffer.from('{"local":true}') });
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('ENOTFOUND'));
		warn.mockRestore();
	});

	it('falls back when the bucket is missing a required file', async () => {
		env.WALLET_ASSETS_SOURCE = 'remote';
		stubFetch(ALL.filter((name) => name !== 'icon.png'));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		expect(await loadPassModel()).toEqual({ 'pass.json': Buffer.from('{"local":true}') });
		warn.mockRestore();
	});
});
