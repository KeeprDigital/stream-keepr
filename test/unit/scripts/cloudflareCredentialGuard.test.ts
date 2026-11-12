import process from 'node:process';
import { expect, it } from 'vitest';

// Wiring: the unit suite's setup files run test/helpers/blockCloudflareCredentials.ts.
// Importing it applies the guard, so the environment is read before the import:
// unwired, it still holds a developer's settings, or no token at all.
it('the unit suite starts holding only a Cloudflare token that authenticates nothing, so no child can use a developer\'s login', async () => {
	const atStart = Object.entries(process.env)
		.filter(([name]) => name.startsWith('CLOUDFLARE_') || name.startsWith('WRANGLER_'));

	const { BLOCKED_CLOUDFLARE_API_TOKEN } = await import('../../helpers/blockCloudflareCredentials.ts');

	expect(atStart).toEqual([
		['CLOUDFLARE_API_TOKEN', BLOCKED_CLOUDFLARE_API_TOKEN],
	]);
});
