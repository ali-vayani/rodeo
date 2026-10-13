import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('loads shared seed dependencies in standalone tsx without SvelteKit modules', () => {
	const output = execFileSync(
		process.execPath,
		[
			'--import',
			'tsx',
			'--input-type=module',
			'-e',
			"await import('./prisma/seedShared.ts'); console.log('seed imports loaded')"
		],
		{ cwd: process.cwd(), encoding: 'utf8' }
	);
	expect(output.trim()).toBe('seed imports loaded');
});
