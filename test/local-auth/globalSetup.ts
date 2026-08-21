import type { NuxtConfig } from '@nuxt/schema';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createTest, exposeContextToEnv, fetch } from '@nuxt/test-utils/e2e';
import {
	LOCAL_RUNTIME_ATTESTATION_NAME,
	LOCAL_RUNTIME_ATTESTATION_VALUE,
} from '../../shared/utils/localDeveloperAuth';
import { prepareIntegrationD1 } from '../integration/integrationD1';
import {
	INTEGRATION_MODE_ENV,
	INTEGRATION_WRANGLER_PERSIST_DIR_ENV,
	resetIntegrationWranglerState,
} from '../integration/state';

const PERSIST_DIR = '.wrangler/state/local-auth-integration';
const disableFsWatchImport = fileURLToPath(new URL('../integration/disable-fs-watch.mjs', import.meta.url));
const nodeOptions = [process.env.NODE_OPTIONS, '--import', disableFsWatchImport].filter(Boolean).join(' ');

export async function setup() {
	const previous = {
		integration: process.env[INTEGRATION_MODE_ENV],
		persistDir: process.env[INTEGRATION_WRANGLER_PERSIST_DIR_ENV],
		bypass: process.env.NUXT_LOCAL_AUTH_BYPASS,
		attestation: process.env[LOCAL_RUNTIME_ATTESTATION_NAME],
	};
	process.env[INTEGRATION_MODE_ENV] = 'true';
	process.env[INTEGRATION_WRANGLER_PERSIST_DIR_ENV] = PERSIST_DIR;
	process.env.NUXT_LOCAL_AUTH_BYPASS = 'true';
	process.env[LOCAL_RUNTIME_ATTESTATION_NAME] = LOCAL_RUNTIME_ATTESTATION_VALUE;

	await resetIntegrationWranglerState(PERSIST_DIR);
	await prepareIntegrationD1();

	const hooks = createTest({
		dev: true,
		env: {
			[INTEGRATION_MODE_ENV]: 'true',
			[INTEGRATION_WRANGLER_PERSIST_DIR_ENV]: PERSIST_DIR,
			NUXT_LOCAL_AUTH_BYPASS: 'true',
			[LOCAL_RUNTIME_ATTESTATION_NAME]: LOCAL_RUNTIME_ATTESTATION_VALUE,
			NUXT_BETTER_AUTH_SECRET: '',
			NUXT_ADMIN_BOOTSTRAP_TOKEN: '',
			NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
			NODE_OPTIONS: nodeOptions,
		},
		nuxtConfig: {
			nitro: { cloudflare: { dev: { persistDir: PERSIST_DIR } } },
			watchers: { chokidar: { usePolling: true, interval: 1000 } },
			typescript: { typeCheck: false },
			vite: { server: { hmr: false, watch: null as unknown as undefined } },
		} as NuxtConfig,
	});

	await hooks.beforeAll();
	exposeContextToEnv();
	const ready = await fetch('/api/events');
	if (!ready.ok)
		throw new Error(`Local auth test server readiness failed with ${ready.status}: ${await ready.text()}`);

	return async () => {
		await hooks.afterAll();
		await resetIntegrationWranglerState(PERSIST_DIR);
		for (const [name, value] of [
			[INTEGRATION_MODE_ENV, previous.integration],
			[INTEGRATION_WRANGLER_PERSIST_DIR_ENV, previous.persistDir],
			['NUXT_LOCAL_AUTH_BYPASS', previous.bypass],
			[LOCAL_RUNTIME_ATTESTATION_NAME, previous.attestation],
		] as const) {
			if (value === undefined)
				delete process.env[name];
			else
				process.env[name] = value;
		}
	};
}
