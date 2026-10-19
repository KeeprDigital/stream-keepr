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
 * worker's own server. A line the previous test's server wrote just before this
 * test began can still land inside its window: a report may show one too many,
 * never one too few.
 */

/**
 * The server's output reaches its file through globalSetup's process, so a line
 * logged as the failing response was sent may land after the test fails — later
 * still on the loaded machine a flake needs. The window is read again until it
 * stops growing, within a bound that keeps a report from waiting on a chatty
 * server.
 */
const SERVER_LOG_QUIET_MILLISECONDS = 200;
const SERVER_LOG_SETTLE_LIMIT_MILLISECONDS = 3_000;

const serverLog = createServerLogWindow(integrationServerLogPath(getIntegrationWranglerPersistDir()));

async function settledServerLog(): Promise<string[]> {
	const sleep = () => new Promise(resolve => setTimeout(resolve, SERVER_LOG_QUIET_MILLISECONDS));
	const deadline = Date.now() + SERVER_LOG_SETTLE_LIMIT_MILLISECONDS;
	let logged = serverLog.since();
	while (Date.now() < deadline) {
		await sleep();
		const next = serverLog.since();
		if (next.join('\n') === logged.join('\n'))
			break;
		logged = next;
	}
	return logged;
}

beforeEach((context) => {
	requestLedger.clear();
	serverLog.mark();
	context.onTestFailed(async () => {
		const logged = await settledServerLog();
		console.error([
			`[integration] requests during "${context.task.name}":`,
			...requestLedger.report().map(line => `  ${line}`),
			logged.length
				? `[integration] server log during "${context.task.name}":`
				: `[integration] server log during "${context.task.name}": no line reached its file`,
			...logged.map(line => `  ${line}`),
		].join('\n'));
	});
});
