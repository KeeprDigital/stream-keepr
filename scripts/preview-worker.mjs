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
import { LIVE_RESULTS_CRON } from '../server/utils/cronSchedules.ts';
import { startLocalCron } from '../server/utils/localCron.ts';

const DEFAULT_PORT = 8787;
const CRON_INTERVAL_MS = 60_000;

/** The `--port` the caller passed through to Wrangler, else Wrangler's default. */
function portOf(argv) {
	const index = argv.indexOf('--port');
	return index >= 0
		? Number(argv[index + 1])
		: DEFAULT_PORT;
}

/** A Worker still starting refuses the connection; only other failures are worth a line. */
function isNotListening(error) {
	return error?.cause?.code === 'ECONNREFUSED';
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
	const port = portOf(argv);
	const passthrough = argv.includes('--port')
		? argv
		: [
				...argv,
				'--port',
				String(port),
			];
	const child = spawnProcess(join(repositoryRoot, 'node_modules/.bin/wrangler'), [
		'dev',
		'--local',
		'--config',
		'.output/server/wrangler.json',
		'--persist-to',
		'.wrangler/state/built-worker',
		'--test-scheduled',
		...passthrough,
	], { cwd: repositoryRoot, stdio: 'inherit' });

	const scheduledUrl = new URL(`http://localhost:${port}/__scheduled`);
	scheduledUrl.searchParams.set('cron', LIVE_RESULTS_CRON);
	const cron = startLocalCron({
		intervalMs: CRON_INTERVAL_MS,
		fire: async () => {
			const response = await fetchRequest(scheduledUrl.href);
			if (!response.ok)
				throw new Error(`/__scheduled answered ${response.status}`);
		},
		onError: (error) => {
			if (!isNotListening(error))
				process.stderr.write(`preview: Live Results cron not fired: ${error?.message ?? error}\n`);
		},
	});

	// Ctrl-C reaches Wrangler through the terminal, so this waits for it to exit;
	// a SIGTERM sent to this process alone is passed on, so workerd is never stranded.
	const ignoreInterrupt = () => {};
	const forwardTerminate = () => child.kill('SIGTERM');
	signals?.on('SIGINT', ignoreInterrupt);
	signals?.on('SIGTERM', forwardTerminate);
	return await new Promise((resolve) => {
		child.once('exit', (code, signal) => {
			cron.stop();
			signals?.off('SIGINT', ignoreInterrupt);
			signals?.off('SIGTERM', forwardTerminate);
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
