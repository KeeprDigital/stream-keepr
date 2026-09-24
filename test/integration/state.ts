import { rm } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { resolve } from 'node:path';
import process from 'node:process';

export const INTEGRATION_MODE_ENV = 'STREAM_KEEPR_INTEGRATION';
/**
 * Everything one integration server writes: its Wrangler state, and (through
 * `nuxt.config.ts`) its Nuxt build directory. One directory per server is what
 * lets several run side by side from one checkout; sharing `.nuxt` races at boot.
 */
export const INTEGRATION_WRANGLER_PERSIST_DIR_ENV = 'STREAM_KEEPR_INTEGRATION_WRANGLER_PERSIST_DIR';
export const DEFAULT_INTEGRATION_WRANGLER_PERSIST_DIR = '.wrangler/state/integration';
export const INTEGRATION_SERVERS_ENV = 'STREAM_KEEPR_INTEGRATION_SERVERS';

/**
 * How many servers the integration suite runs, one test file per server at a time.
 *
 * Files share library-wide state (capacity, retention, reconciliation), so two
 * never run against one database at once; more servers is the only parallelism.
 * Each is a `nuxt dev` plus workerd, and a loaded machine produces timing
 * failures (README § Testing), so the default leaves headroom. Override with
 * `STREAM_KEEPR_INTEGRATION_SERVERS`; `1` is the old serial run.
 */
export function integrationServerCount(env: NodeJS.ProcessEnv = process.env): number {
	const requested = Number.parseInt(env[INTEGRATION_SERVERS_ENV] ?? '', 10);
	if (Number.isInteger(requested) && requested > 0)
		return requested;
	return Math.max(1, Math.min(4, Math.floor(availableParallelism() / 3)));
}

/** The state directory of the `slot`th server (1-based), matching `VITEST_POOL_ID`. */
export function integrationServerPersistDir(slot: number): string {
	return `${DEFAULT_INTEGRATION_WRANGLER_PERSIST_DIR}-${slot}`;
}

/**
 * Tell *this* process that it is the integration suite.
 *
 * The servers inherit this process's environment on top of
 * `integrationServerEnv`, and config-time readers here
 * (`build/localConfiguration.ts` is the current one) must see the same answer
 * they do. Announcing it here means the answer to "is this the integration
 * suite?" is the same in the parent and the child, and is the same question
 * `nuxt.config.ts` already asks.
 *
 * Called before the servers start, which
 * `test/unit/integration/integrationModeAnnouncement.test.ts` enforces rather
 * than trusts.
 */
export function announceIntegrationMode(env: NodeJS.ProcessEnv = process.env) {
	env[INTEGRATION_MODE_ENV] = 'true';
}

export function getIntegrationWranglerPersistDir() {
	return process.env[INTEGRATION_WRANGLER_PERSIST_DIR_ENV] ?? DEFAULT_INTEGRATION_WRANGLER_PERSIST_DIR;
}

export function resolveIntegrationWranglerPersistDir(rootDir = process.cwd(), persistDir = getIntegrationWranglerPersistDir()) {
	return resolve(rootDir, persistDir);
}

export async function resetIntegrationWranglerState(persistDir = getIntegrationWranglerPersistDir()) {
	await rm(resolveIntegrationWranglerPersistDir(process.cwd(), persistDir), { recursive: true, force: true });
}
