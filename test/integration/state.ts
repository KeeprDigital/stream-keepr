import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

export const INTEGRATION_MODE_ENV = 'STREAM_KEEPR_INTEGRATION';
export const INTEGRATION_WRANGLER_PERSIST_DIR_ENV = 'STREAM_KEEPR_INTEGRATION_WRANGLER_PERSIST_DIR';
export const DEFAULT_INTEGRATION_WRANGLER_PERSIST_DIR = '.wrangler/state/integration';

/**
 * Tell *this* process that it is the integration suite.
 *
 * `integrationSetupOptions.env` is not enough, and the difference is not
 * academic. `@nuxt/test-utils` spreads that object into the server child it
 * spawns and nowhere else — but `loadFixture()` runs `loadNuxt()` in this
 * process first, against the repository root, which is where a developer's
 * `.dev.vars` lives. Anything that reads the environment during config load
 * therefore reads an environment with no sign that a suite is running, and
 * whatever it writes there is inherited by the server child, where only the two
 * names `env` happens to pin get overridden.
 *
 * `build/devVars.ts` is the current reader; the point is that it must not have
 * to be the only one anybody remembers. Announcing it here means the answer to
 * "is this the integration suite?" is the same in the parent and the child, and
 * is the same question `nuxt.config.ts` already asks.
 *
 * Called before `createTest`, which `test/unit/integration/integrationModeAnnouncement.test.ts`
 * enforces rather than trusts.
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
