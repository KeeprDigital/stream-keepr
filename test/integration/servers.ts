import type { ChildProcess } from 'node:child_process';
import type { AddressInfo, Server } from 'node:net';
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { basename } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { INTEGRATION_WRANGLER_PERSIST_DIR_ENV } from './state';

/**
 * Starting the `nuxt dev` servers the integration and local-auth suites test.
 *
 * `@nuxt/test-utils`' `createTest` did this until the suite ran more than one
 * server. In dev mode it runs `loadNuxt()` and a build in the globalSetup process
 * and then spawns `nuxi _dev`, which loads and builds everything again for itself;
 * the first copy served nothing. Its context is also a module singleton, so it
 * cannot start two servers at once. This spawns the same `nuxi _dev` child with
 * the same readiness rule and nothing else.
 */

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const nuxi = fileURLToPath(new URL('../../node_modules/.bin/nuxi', import.meta.url));
const HOST = '127.0.0.1';
const START_TIMEOUT_MS = 180_000;
const LOG_LINES_KEPT = 200;
/** Each server's whole output, one file per persist directory, kept after the run. */
const logDirectory = fileURLToPath(new URL('../../node_modules/.cache/integration-servers/', import.meta.url));

export interface IntegrationServer {
	/** The origin with a trailing slash, as `@nuxt/test-utils`' `url('/')` gives it. */
	url: string;
	persistDir: string;
	stop: () => Promise<void>;
}

/** What each test worker needs to address its server; see `selectServer.ts`. */
export const INTEGRATION_SERVER_LIST_ENV = 'STREAM_KEEPR_INTEGRATION_SERVER_LIST';

export interface IntegrationServerAddress {
	url: string;
	persistDir: string;
}

/**
 * The `NUXT_TEST_CONTEXT` a test process needs to address `server`.
 *
 * `@nuxt/test-utils`' `fetch`, `$fetch` and `url` recover their context from this
 * variable on first use, so setting it before a test file runs is all it takes.
 */
export function testContextFor(server: IntegrationServerAddress): string {
	return JSON.stringify({ options: { dev: true, rootDir: repositoryRoot }, url: server.url });
}

/**
 * Reserve `count` distinct free ports. The probes stay open until all are
 * chosen, so one batch never hands out a port twice; `nuxi` falls back to another
 * port silently when its own is taken, which would put two workers on one server.
 */
export async function freePorts(count: number): Promise<number[]> {
	const probes = await Promise.all(Array.from({ length: count }, () => new Promise<Server>((resolve, reject) => {
		const probe = createServer();
		probe.once('error', reject);
		probe.listen(0, HOST, () => resolve(probe));
	})));
	const ports = probes.map(probe => (probe.address() as AddressInfo).port);
	await Promise.all(probes.map(probe => new Promise(resolve => probe.close(resolve))));
	return ports;
}

function exited(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null)
		return Promise.resolve();
	return new Promise(resolve => child.once('exit', () => resolve()));
}

/**
 * Signal the server's whole process group. Signalling `nuxi _dev` alone leaves
 * its workerd children running with no parent, holding sqlite locks.
 */
function signalGroup(child: ChildProcess, signal: NodeJS.Signals) {
	try {
		process.kill(-child.pid!, signal);
	}
	catch {
		// The group is already gone.
	}
}

/**
 * Servers still running when this process exits, however it exits: an
 * interrupted run (`pnpm verify` stopping at another gate's failure) never
 * reaches globalSetup's teardown, and would otherwise strand them.
 */
const running = new Set<ChildProcess>();
process.once('exit', () => {
	for (const child of running)
		signalGroup(child, 'SIGKILL');
});

async function stopChild(child: ChildProcess) {
	const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
	signalGroup(child, 'SIGTERM');
	await Promise.race([exited(child), sleep(5_000)]);
	// Unconditional: workerd may outlive a leader that exited on SIGTERM.
	signalGroup(child, 'SIGKILL');
	await Promise.race([exited(child), sleep(5_000)]);
}

/**
 * Start one server over `persistDir` and resolve once it answers as ready.
 *
 * `env` is laid over this process's environment, then the persist directory and
 * the address are laid over that. A server that exits or never becomes ready
 * rejects with the tail of its own output, which `createTest` captured and never
 * showed.
 */
export async function startIntegrationServer(
	{ persistDir, env, port }: { persistDir: string; env: Record<string, string>; port: number },
): Promise<IntegrationServer> {
	const url = `http://${HOST}:${port}/`;
	const logs: string[] = [];
	const child = spawn(nuxi, ['_dev'], {
		cwd: repositoryRoot,
		// Its own process group, so `stopChild` reaches workerd too.
		detached: true,
		stdio: ['ignore', 'pipe', 'pipe'],
		env: {
			...process.env,
			NODE_ENV: 'development',
			// Info level: the output goes to a file, and a restart or rebuild is worth seeing there.
			CONSOLA_LEVEL: '3',
			...env,
			[INTEGRATION_WRANGLER_PERSIST_DIR_ENV]: persistDir,
			HOST,
			PORT: String(port),
			_PORT: String(port),
		},
	});
	running.add(child);
	child.once('exit', () => running.delete(child));
	mkdirSync(logDirectory, { recursive: true });
	const logFile = createWriteStream(`${logDirectory}${basename(persistDir)}.log`);
	child.once('close', () => logFile.end());
	for (const stream of [child.stdout, child.stderr]) {
		stream?.setEncoding('utf8');
		stream?.on('data', (chunk: string) => {
			logFile.write(chunk);
			logs.push(...chunk.split('\n').filter(Boolean));
			logs.splice(0, Math.max(0, logs.length - LOG_LINES_KEPT));
		});
	}

	const server: IntegrationServer = { url, persistDir, stop: () => stopChild(child) };
	const failure = (reason: string) => new Error(
		`Integration server over ${persistDir} ${reason}. Full output in ${logFile.path}; the last of it:\n${
			logs.slice(-40).join('\n')}`,
	);

	const deadline = Date.now() + START_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (child.exitCode !== null || child.signalCode !== null)
			throw failure(`exited before becoming ready (${child.exitCode ?? child.signalCode})`);
		try {
			const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
			// `nuxt dev` answers 503, then a loading page, before the app is up.
			if (response.status !== 503 && !(await response.text()).includes('__NUXT_LOADING__'))
				return server;
		}
		catch {
			// Not listening yet.
		}
		await new Promise(resolve => setTimeout(resolve, 200));
	}
	await server.stop();
	throw failure(`was not ready within ${START_TIMEOUT_MS / 1000}s`);
}
