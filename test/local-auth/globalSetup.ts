import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
	LOCAL_AUTH_BYPASS_ENABLED_VALUE,
	LOCAL_AUTH_BYPASS_NAME,
} from '../../shared/utils/localDeveloperAuth';
import { prepareIntegrationD1 } from '../integration/integrationD1';
import { freePorts, startIntegrationServer, testContextFor } from '../integration/servers';
import { INTEGRATION_MODE_ENV, resetIntegrationWranglerState } from '../integration/state';

const PERSIST_DIR = '.wrangler/state/local-auth-integration';
const disableFsWatchImport = fileURLToPath(new URL('../integration/disable-fs-watch.mjs', import.meta.url));
const nodeOptions = [process.env.NODE_OPTIONS, '--import', disableFsWatchImport].filter(Boolean).join(' ');

export async function setup() {
	await resetIntegrationWranglerState(PERSIST_DIR);
	await prepareIntegrationD1(PERSIST_DIR);

	// This suite is a launcher, and the only one in the test tree that asks for a
	// bypassed server. Nothing it inherits can arm this: no file assigns the name,
	// and it reaches the server child alone, never this process.
	const [port] = await freePorts(1);
	const server = await startIntegrationServer({
		persistDir: PERSIST_DIR,
		port: port!,
		env: {
			[INTEGRATION_MODE_ENV]: 'true',
			[LOCAL_AUTH_BYPASS_NAME]: LOCAL_AUTH_BYPASS_ENABLED_VALUE,
			NUXT_BETTER_AUTH_SECRET: '',
			NUXT_ADMIN_BOOTSTRAP_TOKEN: '',
			NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
			NODE_OPTIONS: nodeOptions,
		},
	});
	process.env.NUXT_TEST_CONTEXT = testContextFor(server);

	const ready = await fetch(new URL('/api/events', server.url));
	if (!ready.ok) {
		const detail = await ready.text();
		await server.stop();
		throw new Error(`Local auth test server readiness failed with ${ready.status}: ${detail}`);
	}

	return async () => {
		await server.stop();
		await resetIntegrationWranglerState(PERSIST_DIR);
	};
}
