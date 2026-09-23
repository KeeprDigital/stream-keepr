import type { IntegrationServer, IntegrationServerAddress } from './servers';
import process from 'node:process';
import { main as reapStrandedWorkerd } from '../../scripts/reap-workerd.mjs';
import { signInAsOperator } from './client';
import { INTEGRATION_REALTIME_SKIP_NOTICE, integrationRealtimeConfigured, integrationServerEnv } from './helpers';
import { prepareIntegrationD1 } from './integrationD1';
import { freePorts, INTEGRATION_SERVER_LIST_ENV, startIntegrationServer } from './servers';
import {
	announceIntegrationMode,
	integrationServerCount,
	integrationServerPersistDir,
	resetIntegrationWranglerState,
} from './state';
import './disable-fs-watch.mjs';

/**
 * That the server is up, its database is migrated, and an operator can get in.
 *
 * `/api/events` is the readiness probe because it reads D1 — a server that
 * answers it has run its migrations. Since #396 it is also behind the API
 * boundary, so this now proves the second thing as well: that the suite's
 * operator exists and its session is accepted. Both facts are worth failing here
 * for. Without the second, a broken sign-in would surface as every test in the
 * run answering 401, with nothing naming the cause.
 */
async function assertIntegrationServerReady(server: IntegrationServer) {
	const request = (path: string, init?: RequestInit) => fetch(new URL(path, server.url), init);
	const cookie = await signInAsOperator(request, server.url);
	const response = await request('/api/events', { headers: { cookie } });
	if (!response.ok) {
		const detail = await response.text();
		throw new Error(
			`Integration server database readiness check failed with status ${response.status}: ${detail}`,
		);
	}
}

async function startReadyServer(persistDir: string, port: number): Promise<IntegrationServer> {
	await resetIntegrationWranglerState(persistDir);
	await prepareIntegrationD1(persistDir);
	const server = await startIntegrationServer({ persistDir, env: integrationServerEnv, port });
	try {
		await assertIntegrationServerReady(server);
	}
	catch (error) {
		await server.stop();
		throw error;
	}
	return server;
}

/**
 * Start one server per test worker, each over its own database.
 *
 * Test files share library-wide state, so a server serves one file at a time;
 * `selectServer.ts` pins each worker to the server matching its pool id.
 */
async function startIntegrationServers(): Promise<IntegrationServer[]> {
	const persistDirs = Array.from(
		{ length: integrationServerCount() },
		(_, index) => integrationServerPersistDir(index + 1),
	);
	const ports = await freePorts(persistDirs.length);
	const started = await Promise.allSettled(persistDirs.map((persistDir, index) => startReadyServer(persistDir, ports[index]!)));
	const servers = started.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
	const failed = started.find(result => result.status === 'rejected');
	if (failed) {
		await Promise.all(servers.map(server => server.stop()));
		throw failed.reason;
	}
	return servers;
}

export async function setup() {
	// First: the servers inherit this process's environment, and anything here
	// that reads the environment must see the same answer they do.
	announceIntegrationMode();

	// Say this once, before anything runs, so a reader meets the reason for the
	// skipped tests rather than having to work back to it from a bare skip mark.
	if (!integrationRealtimeConfigured)
		console.warn(INTEGRATION_REALTIME_SKIP_NOTICE);

	// A workerd stranded by a killed session still holds sqlite locks on the
	// persist directories; sweep them before touching that state.
	await reapStrandedWorkerd();

	const servers = await startIntegrationServers();
	const addresses: IntegrationServerAddress[] = servers.map(({ url, persistDir }) => ({ url, persistDir }));
	process.env[INTEGRATION_SERVER_LIST_ENV] = JSON.stringify(addresses);

	return async () => {
		await Promise.all(servers.map(server => server.stop()));
		await Promise.all(servers.map(server => resetIntegrationWranglerState(server.persistDir)));
	};
}
