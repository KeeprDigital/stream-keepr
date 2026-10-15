/**
 * Every round trip the current integration test made, read when it fails (#475).
 *
 * #123 and #475 are one class: an `it` chaining many round trips against a 30 s
 * budget times out under parallel load, passes in isolation, and reports only
 * that the chain as a whole ran out of time. #123's evidence says that is one
 * operation stalling rather than a slow machine — so the useful report names the
 * operation. `graphicsAssetReplacement.test.ts` does that by hand with `step`;
 * this does it for every suite, because `./client.ts` records each request here
 * and `./requestLedgerReport.ts` prints the ledger when a test fails.
 *
 * A stalled request never settles, so it is the entry still `never returned`.
 *
 * Imports nothing, like `./transportRetry.ts`, so
 * `test/unit/integration/requestLedger.test.ts` can pin it without a server.
 */

/** The most recent requests a report lists; anything older is listed only if pending. */
const REPORTED_REQUESTS = 20;

interface Entry {
	label: string;
	startedAt: number;
	milliseconds?: number;
	threw?: boolean;
}

export function createRequestLedger(now: () => number = Date.now) {
	let entries: Entry[] = [];

	return {
		async record<T>(label: string, run: () => Promise<T>): Promise<T> {
			const entry: Entry = { label, startedAt: now() };
			entries.push(entry);
			try {
				return await run();
			}
			catch (error) {
				entry.threw = true;
				throw error;
			}
			finally {
				entry.milliseconds = now() - entry.startedAt;
			}
		},

		report(): string[] {
			const describe = ({ label, startedAt, milliseconds, threw }: Entry) => {
				if (milliseconds === undefined)
					return `${label}: never returned (waited ${now() - startedAt}ms)`;
				return `${label}: ${threw ? 'threw after ' : ''}${milliseconds}ms`;
			};
			const earlier = entries.slice(0, -REPORTED_REQUESTS);
			const stillPending = earlier.filter(entry => entry.milliseconds === undefined);
			const elided = earlier.length - stillPending.length;

			return [
				...stillPending.map(describe),
				...(elided > 0 ? [`… ${elided} earlier requests returned`] : []),
				...entries.slice(-REPORTED_REQUESTS).map(describe),
			];
		},

		clear() {
			entries = [];
		},
	};
}

/** This worker's ledger: written by `./client.ts`, read by `./requestLedgerReport.ts`. */
export const requestLedger = createRequestLedger();
