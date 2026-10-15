import { beforeEach } from 'vitest';
import { requestLedger } from './requestLedger';

/**
 * Print a failed test's round trips, so a timeout names the one it was waiting on
 * (#475). See `./requestLedger.ts`.
 *
 * A setup file rather than a hook in each suite, so a suite added later is
 * covered without its author knowing this exists. What it cannot name is a stall
 * in a `beforeAll`: Vitest reports that as a hook timeout, with no test failing.
 */
beforeEach((context) => {
	requestLedger.clear();
	context.onTestFailed(() => {
		console.error([
			`[integration] round trips during "${context.task.name}":`,
			...requestLedger.report().map(line => `  ${line}`),
		].join('\n'));
	});
});
