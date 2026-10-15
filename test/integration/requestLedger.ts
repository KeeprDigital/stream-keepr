/**
 * Every request the current integration test made, read when it fails (#475).
 *
 * #123 and #475 are one class: an `it` chaining many requests against a 30 s
 * budget times out under parallel load, passes in isolation, and reports only
 * that the chain as a whole ran out of time. #123's evidence says that is one
 * operation stalling rather than a slow machine — so the useful report names the
 * operation. `graphicsAssetReplacement.test.ts` does that by hand with `step`;
 * this does it for every suite, because `./client.ts` records each request here
 * and `./requestLedgerReport.ts` prints the ledger when a test fails.
 *
 * A stalled request never settles, so it is the entry still `never returned`.
 * What it names is the route, not the stall inside it: a route stalled on its
 * Ably publish and one stalled on D1 read the same here. And `fetch` settles
 * when the headers arrive, so a stall reading a body afterwards shows every
 * request as returned.
 *
 * Imports nothing, like `./transportRetry.ts`, so
 * `test/unit/integration/requestLedger.test.ts` can pin it without a server.
 */

/** The most recent requests a report lists; anything older is listed only if pending. */
const REPORTED_REQUESTS = 20;

interface RecordedRequest {
	label: string;
	startedAt: number;
	milliseconds?: number;
	threw?: boolean;
}

/** How a request reads in a report: its method, defaulting as `fetch` does, and its path. */
export function requestLabel(path: string, method: unknown): string {
	return `${typeof method === 'string' ? method.toUpperCase() : 'GET'} ${path}`;
}

export function createRequestLedger(now: () => number = Date.now) {
	let requests: RecordedRequest[] = [];

	return {
		async record<T>(label: string, run: () => Promise<T>): Promise<T> {
			const request: RecordedRequest = { label, startedAt: now() };
			requests.push(request);
			try {
				return await run();
			}
			catch (error) {
				request.threw = true;
				throw error;
			}
			finally {
				request.milliseconds = now() - request.startedAt;
			}
		},

		report(): string[] {
			const line = ({ label, startedAt, milliseconds, threw }: RecordedRequest) => {
				if (milliseconds === undefined)
					return `${label}: never returned (waited ${now() - startedAt}ms)`;
				return `${label}: ${threw ? 'threw after ' : ''}${milliseconds}ms`;
			};
			const earlier = requests.slice(0, -REPORTED_REQUESTS);
			const stillPending = earlier.filter(request => request.milliseconds === undefined);
			const elided = earlier.length - stillPending.length;

			return [
				...stillPending.map(line),
				...(elided > 0 ? [`… ${elided} earlier requests returned`] : []),
				...requests.slice(-REPORTED_REQUESTS).map(line),
			];
		},

		clear() {
			requests = [];
		},
	};
}

/** This worker's ledger: written by `./client.ts`, read by `./requestLedgerReport.ts`. */
export const requestLedger = createRequestLedger();
