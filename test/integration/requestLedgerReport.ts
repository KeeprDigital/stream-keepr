import { beforeEach } from 'vitest';
import { requestLedger } from './requestLedger';
import { createServerLogWindow } from './serverLogWindow';
import { integrationServerLogPath } from './servers';
import { getIntegrationWranglerPersistDir } from './state';

/**
 * Print a failed test's requests, so a timeout names the one it was waiting on
 * (#475), and what its server logged meanwhile, so a refusal says why (#633).
 * See `./requestLedger.ts` and `./serverLogWindow.ts`.
 *
 * A setup file rather than a hook in each suite, so a suite added later is
 * covered without its author knowing this exists. What it cannot name is a stall
 * in a `beforeAll`: Vitest reports that as a hook timeout, with no test failing.
 * `./selectServer.ts` runs first, so the persist directory read here is this
 * worker's own server.
 */

/**
 * The server's output reaches its file through globalSetup's process, so a line
 * logged as the failing response was sent may land a moment after the test
 * fails.
 */
const SERVER_LOG_SETTLE_MILLISECONDS = 250;

const serverLog = createServerLogWindow(integrationServerLogPath(getIntegrationWranglerPersistDir()));

beforeEach((context) => {
	requestLedger.clear();
	serverLog.mark();
	context.onTestFailed(async () => {
		await new Promise(resolve => setTimeout(resolve, SERVER_LOG_SETTLE_MILLISECONDS));
		const logged = serverLog.since();
		console.error([
			`[integration] requests during "${context.task.name}":`,
			...requestLedger.report().map(line => `  ${line}`),
			`[integration] server log during "${context.task.name}"${logged.length ? ':' : ': nothing'}`,
			...logged.map(line => `  ${line}`),
		].join('\n'));
	});
});
