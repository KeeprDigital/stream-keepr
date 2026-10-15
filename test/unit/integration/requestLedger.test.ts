import { describe, expect, it } from 'vitest';
import { createRequestLedger, requestLabel } from '~~/test/integration/requestLedger';

/**
 * The integration suite's request ledger, and the one question it exists to
 * answer: which round trip was a timed-out test waiting on (#475, #123)?
 *
 * A test that chains a dozen requests against a 30 s budget reports, on a stall,
 * only that the chain ran out of time. The ledger is read when a test fails, so
 * these rows pin what that report says. A clock is injected so each duration is
 * a literal rather than whatever the machine happened to take.
 */

function clock(start = 1_000) {
	let now = start;
	return {
		now: () => now,
		advance: (milliseconds: number) => {
			now += milliseconds;
		},
	};
}

/** A request the test resolves by hand, so it can be left pending on purpose. */
function deferred<T = void>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe('the integration suite\'s request ledger', () => {
	it('names the request a stalled test is still waiting on, after the ones that returned', async () => {
		const time = clock();
		const ledger = createRequestLedger(time.now);

		const taken = deferred();
		const recordedTake = ledger.record('POST /api/events/1/commands', () => taken.promise);
		time.advance(120);
		taken.resolve();
		await recordedTake;

		void ledger.record('GET /api/events/1/live-session', () => deferred().promise);
		time.advance(30_000);

		expect(ledger.report()).toEqual([
			'POST /api/events/1/commands: 120ms',
			'GET /api/events/1/live-session: never returned (waited 30000ms)',
		]);
	});

	it('tells a request that threw from one that answered, and passes the error through', async () => {
		// `$fetch` rejects on a refusal, so "it returned" would misdescribe a 409 the
		// test then failed on — and the ledger must not swallow the error it records.
		const time = clock();
		const ledger = createRequestLedger(time.now);
		const refused = deferred();
		const recorded = ledger.record('POST /api/events/1/commands', () => refused.promise);
		time.advance(45);
		refused.reject(new Error('409 Conflict'));

		await expect(recorded).rejects.toThrow('409 Conflict');
		expect(ledger.report()).toEqual(['POST /api/events/1/commands: threw after 45ms']);
	});

	it('starts each test from nothing, so a report holds only that test\'s requests', async () => {
		const time = clock();
		const ledger = createRequestLedger(time.now);
		await ledger.record('POST /api/events', async () => {});
		void ledger.record('GET /api/left-behind', () => deferred().promise);

		ledger.clear();
		await ledger.record('GET /api/events/1', async () => {});

		expect(ledger.report()).toEqual(['GET /api/events/1: 0ms']);
	});

	it('elides the oldest answered requests of a long chain, but never a pending one', async () => {
		// A hundred-request test would otherwise print a hundred lines around the one
		// that matters. A pending request is the one that matters wherever it sits.
		const time = clock();
		const ledger = createRequestLedger(time.now);
		void ledger.record('GET /api/stalled-first', () => deferred().promise);
		for (let index = 1; index <= 30; index++)
			await ledger.record(`GET /api/${index}`, async () => {});

		const report = ledger.report();

		expect(report[0]).toBe('GET /api/stalled-first: never returned (waited 0ms)');
		expect(report[1]).toBe('… 10 earlier requests returned');
		expect(report[2]).toBe('GET /api/11: 0ms');
		expect(report.at(-1)).toBe('GET /api/30: 0ms');
		expect(report).toHaveLength(22);
	});

	it('labels a request by method and path, reading no method as the GET it is sent as', () => {
		expect(requestLabel('/api/events/1', 'patch')).toBe('PATCH /api/events/1');
		expect(requestLabel('/api/events/1', undefined)).toBe('GET /api/events/1');
	});
});
