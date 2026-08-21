/**
 * Start the already-built Cloudflare Worker under local workerd and drive the
 * production-shaped smoke probes from a separate Node process.
 *
 * This command never builds. `pnpm verify` and CI build once, run the static
 * dry run, then hand the same artifact here. It first exercises real Better
 * Auth, then restarts that artifact to prove the bypass flag fails closed by
 * itself and admits the Local Developer Session only with an explicit local
 * runtime attestation.
 */

import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
	formatWorkerSmokeFailure,
	runWorkerSmoke,
	WorkerSmokeFailure,
} from './worker-smoke/runner.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

export async function main() {
	const interrupted = new AbortController();
	const onSignal = signal => interrupted.abort(new WorkerSmokeFailure('runner', 'interrupted', {
		expected: 'completed smoke run',
		actual: signal,
	}));
	const onInterrupt = () => onSignal('SIGINT');
	const onTerminate = () => onSignal('SIGTERM');
	process.once('SIGINT', onInterrupt);
	process.once('SIGTERM', onTerminate);
	try {
		const result = await runWorkerSmoke({ repositoryRoot, signal: interrupted.signal });
		process.stdout.write(`worker:smoke: passed in ${result.elapsedMs}ms\n`);
	}
	catch (error) {
		process.stderr.write(formatWorkerSmokeFailure(error));
		process.exitCode = error?.failureClass === 'interrupted' ? 130 : 1;
	}
	finally {
		process.removeListener('SIGINT', onInterrupt);
		process.removeListener('SIGTERM', onTerminate);
	}
}

if (import.meta.main)
	await main();
