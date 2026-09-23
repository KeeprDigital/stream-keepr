import type { IntegrationServerAddress } from './servers';
import process from 'node:process';
import { INTEGRATION_SERVER_LIST_ENV, testContextFor } from './servers';
import { INTEGRATION_WRANGLER_PERSIST_DIR_ENV } from './state';

/**
 * Point this test worker at its own integration server.
 *
 * `globalSetup.ts` starts one server per worker. Vitest numbers workers
 * 1…`maxWorkers` in `VITEST_POOL_ID`, and no two running files share an id, so
 * no two files ever share a database at once. This runs before the test file's
 * own imports, so everything downstream reads the chosen server:
 * `@nuxt/test-utils` recovers its context (and so `url()`) from
 * `NUXT_TEST_CONTEXT`, and `integrationD1.ts` opens the persist directory.
 */

const servers = JSON.parse(process.env[INTEGRATION_SERVER_LIST_ENV] ?? '[]') as IntegrationServerAddress[];
const poolId = Number(process.env.VITEST_POOL_ID ?? '1');
const server = servers[poolId - 1];
if (!server) {
	throw new Error(
		`Integration worker ${poolId} has no server: globalSetup started ${servers.length}. `
		+ 'vitest.integration.config.ts must set maxWorkers to integrationServerCount().',
	);
}

process.env.NUXT_TEST_CONTEXT = testContextFor(server);
process.env[INTEGRATION_WRANGLER_PERSIST_DIR_ENV] = server.persistDir;
