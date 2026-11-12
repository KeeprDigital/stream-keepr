import process from 'node:process';
import { expect, it } from 'vitest';

// Wiring: the Nuxt suite's setup files run test/helpers/blockCloudflareCredentials.ts,
// as the unit suite's do (test/unit/scripts/cloudflareCredentialGuard.test.ts).
// Importing it applies the guard, so the environment is read before the import.
it('the Nuxt suite starts holding only a Cloudflare token that authenticates nothing', async () => {
	const atStart = Object.entries(process.env)
		.filter(([name]) => name.startsWith('CLOUDFLARE_') || name.startsWith('WRANGLER_'));

	const { BLOCKED_CLOUDFLARE_API_TOKEN } = await import('../helpers/blockCloudflareCredentials.ts');

	expect(atStart).toEqual([
		['CLOUDFLARE_API_TOKEN', BLOCKED_CLOUDFLARE_API_TOKEN],
	]);
});
