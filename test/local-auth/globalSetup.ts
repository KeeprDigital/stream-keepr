import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { warmChromium } from '../../scripts/graphics-acceptance/chromium.mjs';
import { prepareIntegrationD1 } from '../integration/integrationD1';
import { freePorts, startIntegrationServer, testContextFor } from '../integration/servers';
import { integrationEventIdBlocks, resetIntegrationWranglerState } from '../integration/state';
import { localAuthServerEnv } from './serverEnv';

const PERSIST_DIR = '.wrangler/state/local-auth-integration';
const disableFsWatchImport = fileURLToPath(new URL('../integration/disable-fs-watch.mjs', import.meta.url));
const nodeOptions = [process.env.NODE_OPTIONS, '--import', disableFsWatchImport].filter(Boolean).join(' ');

export async function setup() {
	// Before the dev server, so the cold launch has the machine to itself (#790).
	const warmingStarted = Date.now();
	const warmed = await warmChromium();
	if (warmed)
		process.stdout.write(`local-auth: first launch of ${warmed} took ${Date.now() - warmingStarted} ms\n`);
	await resetIntegrationWranglerState(PERSIST_DIR);
	// Its own Event-id block, as each integration server has (#630): were the
	// server ever given an Ably key, its Event would still not be `event:1`.
	const [firstEventId] = integrationEventIdBlocks(1);
	await prepareIntegrationD1(PERSIST_DIR, { firstEventId });

	const [port] = await freePorts(1);
	const server = await startIntegrationServer({
		persistDir: PERSIST_DIR,
		port: port!,
		env: localAuthServerEnv({ nodeOptions }),
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
