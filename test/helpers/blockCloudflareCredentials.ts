/**
 * The unit and Nuxt suites never reach Cloudflare, so they must not be able to.
 *
 * Wrangler falls back to the developer's stored OAuth login when nothing else
 * is set, and every child process a test starts inherits this environment. A
 * test that started a real acceptance runner by mistake therefore wrote to
 * production during #619's development. Setting an API token makes Wrangler
 * use it instead of the login, so a stray remote call fails authentication
 * rather than writing anywhere; every other Cloudflare and Wrangler setting is
 * cleared so none can pick an account.
 */

import process from 'node:process';

export const BLOCKED_CLOUDFLARE_API_TOKEN = 'blocked-by-test-guard';

for (const name of Object.keys(process.env)) {
	if (name.startsWith('CLOUDFLARE_') || name.startsWith('WRANGLER_'))
		delete process.env[name];
}
process.env.CLOUDFLARE_API_TOKEN = BLOCKED_CLOUDFLARE_API_TOKEN;
