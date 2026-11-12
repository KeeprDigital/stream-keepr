import type { IntegrationServer, IntegrationServerAddress } from './servers';
import process from 'node:process';
import { main as reapStrandedWorkerd } from '../../scripts/reap-workerd.mjs';
import { acquireRunSlots, RUN_SLOT_COSTS } from '../../scripts/slots.mjs';
import { signInAsOperator } from './client';
import { INTEGRATION_REALTIME_SKIP_NOTICE, integrationServerEnv, keylessIntegrationServerEnv } from './helpers';
import { prepareIntegrationD1 } from './integrationD1';
import { integrationRealtimeConfigured } from './realtimeKey';
import { freePorts, INTEGRATION_SERVER_LIST_ENV, startIntegrationServer } from './servers';
import {
	announceIntegrationMode,
	INTEGRATION_REALTIME_SERVER_ENV,
	INTEGRATION_REALTIME_SERVER_PERSIST_DIR,
	integrationEventIdBlocks,
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
	const response = await request('/api/events', {
		headers: { cookie },
	});
	if (!response.ok) {
		const detail = await response.text();
		throw new Error(
			`Integration server database readiness check failed with status ${response.status}: ${detail}`,
		);
	}
}

async function startReadyServer(
	persistDir: string,
	port: number,
	firstEventId: number,
	env: Record<string, string>,
): Promise<IntegrationServer> {
	await resetIntegrationWranglerState(persistDir);
	await prepareIntegrationD1(persistDir, { firstEventId });
	const server = await startIntegrationServer({ persistDir, env, port });
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
 * Start one keyless server per test worker, each over its own database and
 * minting Event ids from its own block, and the realtime server beside them.
 *
 * Test files share library-wide state, so a server serves one file at a time;
 * `selectServer.ts` pins each worker to the server matching its pool id.
 *
 * The realtime server is the only one given the Ably key, and comes last in
 * the answer (`./state.ts` § realtime server). A run with no key starts none:
 * the realtime files then take the first server, which is idle while they run.
 */
async function startIntegrationServers(): Promise<{ servers: IntegrationServer[]; realtime: IntegrationServer }> {
	const specs = Array.from(
		{
			length: integrationServerCount(),
		},
		(_, index) => ({
			persistDir: integrationServerPersistDir(index + 1),
			env: keylessIntegrationServerEnv,
		}),
	);
	if (integrationRealtimeConfigured)
		specs.push({ persistDir: INTEGRATION_REALTIME_SERVER_PERSIST_DIR, env: integrationServerEnv });
	const ports = await freePorts(specs.length);
	const firstEventIds = integrationEventIdBlocks(specs.length);
	const started = await Promise.allSettled(specs.map(({ persistDir, env }, index) =>
		startReadyServer(persistDir, ports[index]!, firstEventIds[index]!, env)));
	const servers = started.flatMap(result => result.status === 'fulfilled'
		? [result.value]
		: []);
	const failed = started.find(result => result.status === 'rejected');
	if (failed) {
		await Promise.all(servers.map(server => server.stop()));
		throw failed.reason;
	}
	return {
		servers,
		realtime: integrationRealtimeConfigured
			? servers.at(-1)!
			: servers[0]!,
	};
}

export async function setup() {
	// First: the servers inherit this process's environment, and anything here
	// that reads the environment must see the same answer they do.
	announceIntegrationMode();

	// Say this once, before anything runs, so a reader meets the reason for the
	// skipped tests rather than having to work back to it from a bare skip mark.
	if (!integrationRealtimeConfigured)
		console.warn(INTEGRATION_REALTIME_SKIP_NOTICE);

	// The whole machine's run slots, before anything starts: these tests time
	// real requests against several servers, and another suite beside them, in
	// this worktree or any other, makes every result meaningless.
	const slots = await acquireRunSlots({ want: RUN_SLOT_COSTS.integration, label: 'integration suite' });

	// A workerd stranded by a killed session still holds sqlite locks on the
	// persist directories; sweep them before touching that state.
	await reapStrandedWorkerd();

	const { servers, realtime } = await startIntegrationServers().catch((error) => {
		slots.release();
		throw error;
	});
	const address = ({ url, persistDir }: IntegrationServer): IntegrationServerAddress => ({ url, persistDir });
	// The pool list may include the realtime server: no pool id reaches past the keyless ones.
	process.env[INTEGRATION_SERVER_LIST_ENV] = JSON.stringify(servers.map(address));
	process.env[INTEGRATION_REALTIME_SERVER_ENV] = JSON.stringify(address(realtime));

	return async () => {
		await Promise.all(servers.map(server => server.stop()));
		await Promise.all(servers.map(server => resetIntegrationWranglerState(server.persistDir)));
		slots.release();
	};
}
