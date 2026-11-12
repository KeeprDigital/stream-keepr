/**
 * The last step of `pnpm preview`: run the built Worker under local workerd and
 * stand in for its Live Results cron trigger.
 *
 * No local runtime fires a cron trigger, so Melee Live Results would never tick
 * here (#887). Wrangler's `--test-scheduled` exposes `/__scheduled`, which calls
 * the Worker's own scheduled handler as Cloudflare does; this fires the minute
 * cron there at once and then each minute (`server/utils/localCron.ts`). The
 * deployed Worker is untouched: the route exists only under `wrangler dev`.
 */

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { LIVE_RESULTS_CRON, LIVE_RESULTS_CRON_INTERVAL_MS } from '../server/utils/cronSchedules.ts';
import { startLocalCron } from '../server/utils/localCron.ts';

/** The generated config Wrangler runs; `.output/server/.env` is read beside it. */
const PREVIEW_WRANGLER_CONFIG = '.output/server/wrangler.json';
const DEFAULT_PORT = 8787;
const STOP_SIGNALS = ['SIGINT', 'SIGTERM'];

/**
 * Splits the caller's Wrangler arguments into the port (`--port N` or
 * `--port=N`, else Wrangler's default) and the rest, so the cron always fires at
 * the port Wrangler listens on.
 */
export function splitPort(argv) {
	let port = DEFAULT_PORT;
	const rest = [];
	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index];
		if (argument === '--port')
			port = Number(argv[++index]);
		else if (argument.startsWith('--port='))
			port = Number(argument.slice('--port='.length));
		else
			rest.push(argument);
	}
	if (!Number.isInteger(port) || port < 1 || port > 65_535)
		throw new Error(`preview: --port must be a TCP port, not ${JSON.stringify(String(port))}`);
	return { port, rest };
}

/** How long the first firing waits for Wrangler to start listening. */
const STARTUP_WAIT_MS = 60_000;

function isNotListening(error) {
	return error?.cause?.code === 'ECONNREFUSED';
}

/** Retries `request` while the Worker is still starting, so the first firing lands once it listens. */
async function onceListening(request) {
	const deadline = Date.now() + STARTUP_WAIT_MS;
	for (;;) {
		try {
			return await request();
		}
		catch (error) {
			if (!isNotListening(error) || Date.now() > deadline)
				throw error;
			await new Promise(resolve => setTimeout(resolve, 250));
		}
	}
}

/**
 * Starts Wrangler on the built Worker with `argv` passed through, fires the Live
 * Results cron at it each minute, and resolves with Wrangler's exit code.
 */
export async function runPreviewWorker({
	argv,
	repositoryRoot,
	spawnProcess = spawn,
	fetchRequest = fetch,
	signals = undefined,
}) {
	const { port, rest } = splitPort(argv);
	const child = spawnProcess(join(repositoryRoot, 'node_modules/.bin/wrangler'), [
		'dev',
		'--local',
		'--config',
		PREVIEW_WRANGLER_CONFIG,
		'--persist-to',
		'.wrangler/state/built-worker',
		'--test-scheduled',
		'--port',
		String(port),
		...rest,
	], { cwd: repositoryRoot, stdio: 'inherit' });

	const scheduledUrl = new URL(`http://localhost:${port}/__scheduled`);
	scheduledUrl.searchParams.set('cron', LIVE_RESULTS_CRON);
	const cron = startLocalCron({
		intervalMs: LIVE_RESULTS_CRON_INTERVAL_MS,
		fire: async () => {
			const response = await onceListening(() => fetchRequest(scheduledUrl.href));
			if (!response.ok)
				throw new Error(`/__scheduled answered ${response.status}`);
		},
		onError: error => process.stderr.write(`preview: Live Results cron not fired: ${error?.message ?? error}\n`),
	});

	// A stop signal sent to this process alone is passed on and this waits for
	// Wrangler to exit, so workerd is never stranded.
	const forward = signal => child.kill(signal);
	for (const signal of STOP_SIGNALS)
		signals?.on(signal, forward);
	return await new Promise((resolve) => {
		child.once('exit', (code, signal) => {
			cron.stop();
			for (const stopSignal of STOP_SIGNALS)
				signals?.off(stopSignal, forward);
			resolve(code ?? (signal ? 1 : 0));
		});
	});
}

if (import.meta.main) {
	const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
	process.exitCode = await runPreviewWorker({
		argv: process.argv.slice(2),
		repositoryRoot,
		signals: process,
	});
}
