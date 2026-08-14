import { describe, expect, it, vi } from 'vitest';
import { callsTo, lastCallTo } from '~~/test/helpers/lastCallTo';

/**
 * The two things a call-selecting read has to get right, pinned because a shared
 * helper's defects arrive at every site at once.
 *
 * The first is that it **selects**. #273's B1 established that an emptiness guard is
 * the wrong question when a second caller shares the mock: a stray landing last makes
 * `toHaveBeenCalled` pass and hands the test the stray's arguments. So the cases below
 * always put a stray *after* the call under test — an arrangement in which a helper
 * that only guards emptiness returns the wrong tuple and every assertion downstream
 * reads a value nobody asked for.
 *
 * The second is that the failure is a sentence. The shape this replaces dies as
 * `TypeError: Cannot read properties of undefined`, which names neither the mock nor
 * the expectation; under one of #123's load flakes that reads as breakage in whichever
 * branch is running. The message is asserted on, not merely the fact of a throw.
 */

const LEDGER = '/api/admin/graphics-assets/evidence';
const CLOCK = '/api/time';

function recordedFetch() {
	const mock = vi.fn();
	mock(LEDGER, { query: { page: 1 } });
	mock(LEDGER, { query: { page: 2 } });
	mock(CLOCK, { retry: 1 });
	return mock;
}

describe('lastCallTo', () => {
	describe('selecting by endpoint', () => {
		it('takes the last call to the named endpoint, not the last call', () => {
			const [, options] = lastCallTo(recordedFetch(), LEDGER);

			expect(options).toEqual({ query: { page: 2 } });
		});

		it('names the endpoint and lists what arrived when nothing matched', () => {
			const mock = vi.fn();
			mock(CLOCK, { retry: 1 });
			mock(CLOCK, { retry: 1 });

			expect(() => lastCallTo(mock, LEDGER)).toThrow(
				`expected a call to ${LEDGER}, got only ["${CLOCK}", "${CLOCK}"]`,
			);
		});

		it('says so plainly when the mock was never called at all', () => {
			expect(() => lastCallTo(vi.fn(), LEDGER)).toThrow(
				`expected a call to ${LEDGER}, got none`,
			);
		});

		it('elides all but the most recent calls, which are the ones that displaced the match', () => {
			const mock = vi.fn();
			for (let index = 0; index < 7; index++)
				mock(`${CLOCK}?n=${index}`);

			expect(() => lastCallTo(mock, LEDGER)).toThrow(
				`got only [… 2 earlier, "${CLOCK}?n=2", "${CLOCK}?n=3", "${CLOCK}?n=4", "${CLOCK}?n=5", "${CLOCK}?n=6"]`,
			);
		});
	});

	describe('selecting by matcher', () => {
		it('carries subjects whose first argument is not a name', () => {
			const spy = vi.fn();
			spy(JSON.stringify({ message: 'realtime_publish_failed', eventId: 7 }));
			spy(JSON.stringify({ message: 'realtime_publish_oversized', eventId: 7 }));

			const [line] = lastCallTo(spy, isPublishFailureLine);

			expect(JSON.parse(line as string)).toEqual({ message: 'realtime_publish_failed', eventId: 7 });
		});

		it('names the matcher in the failure, so the sentence still says what was wanted', () => {
			const spy = vi.fn();
			spy(JSON.stringify({ message: 'realtime_publish_oversized' }));

			expect(() => lastCallTo(spy, isPublishFailureLine)).toThrow(
				'expected a call matching isPublishFailureLine, got only',
			);
		});

		it('falls back to naming the matcher generically when it is anonymous', () => {
			expect(() => lastCallTo(vi.fn(), (call: unknown[]) => call.length > 99)).toThrow(
				'expected a call matching the given matcher, got none',
			);
		});
	});

	describe('without a selector', () => {
		it('takes the last call, for subjects with exactly one caller', () => {
			const projection = vi.fn();
			projection({ nextSequence: 1 });
			projection({ nextSequence: 2 });

			const [input] = lastCallTo(projection);

			expect(input).toEqual({ nextSequence: 2 });
		});

		it('still says which expectation went unmet rather than dying as a TypeError', () => {
			expect(() => lastCallTo(vi.fn())).toThrow('expected a call, got none');
		});
	});

	describe('rendering what arrived', () => {
		it('truncates an argument too long to belong in a failure message', () => {
			const spy = vi.fn();
			spy('x'.repeat(200));

			// Bounded and marked, so a 200-character log line cannot bury the sentence.
			expect(() => lastCallTo(spy, 'nothing')).toThrow(`only ["${'x'.repeat(79)}…]`);
		});

		it('renders a call that carried no arguments', () => {
			const spy = vi.fn();
			spy();

			expect(() => lastCallTo(spy, 'nothing')).toThrow('got only [(no arguments)]');
		});

		it('degrades rather than throwing its own error on an unrenderable argument', () => {
			// The diagnostic runs on the failure path, so a payload that refuses to be
			// serialised must not replace the named error with a second failure.
			const circular: Record<string, unknown> = {};
			circular.self = circular;
			const spy = vi.fn();
			spy(circular);

			expect(() => lastCallTo(spy, 'nothing')).toThrow('expected a call to nothing, got only [[object Object]]');
		});
	});
});

/**
 * The count a test destructures against, pinned because getting it wrong is silent.
 *
 * `lastCallTo` answers "which call"; this answers "how many", which is the question a
 * test comparing two calls to each other is actually asking. #330's three sites all
 * read `const [first, second] = mock.calls.map(…)`, and every one of them had a run on
 * which the list was shorter than the destructuring and the assertion passed anyway —
 * `expect(first).not.toBe(undefined)` and `expect(undefined).toBe(undefined)` are both
 * vacuous truths. So the first case below is the one that matters: a short list must
 * fail, and fail with a sentence rather than as a `TypeError` three lines later.
 */
describe('callsTo', () => {
	it('hands back exactly the calls the test destructures, in the order they were made', () => {
		const [first, second] = callsTo(recordedFetch(), 2, LEDGER);

		expect(first?.[1]).toEqual({ query: { page: 1 } });
		expect(second?.[1]).toEqual({ query: { page: 2 } });
	});

	it('refuses a list shorter than the test thinks, which is how a vacuous pass happens', () => {
		const mock = vi.fn();
		mock(LEDGER, { query: { page: 1 } });

		expect(() => callsTo(mock, 2, LEDGER)).toThrow(
			`expected 2 calls to ${LEDGER}, got 1; recorded only ["${LEDGER}"]`,
		);
	});

	it('refuses a longer list too, because an extra call means the pair is not the pair', () => {
		expect(() => callsTo(recordedFetch(), 2)).toThrow(
			'expected 2 calls, got 3; recorded only',
		);
	});

	it('counts what the selector accepts, not what the mock recorded', () => {
		// The stray-after-the-subject arrangement the file opens with: an unselected
		// count would read 3 here and refuse a test that is perfectly correct.
		expect(callsTo(recordedFetch(), 2, LEDGER)).toHaveLength(2);
	});

	it('names the matcher when one was given, the way lastCallTo does', () => {
		expect(() => callsTo(vi.fn(), 1, isPublishFailureLine)).toThrow(
			'expected 1 call matching isPublishFailureLine, got 0; recorded none',
		);
	});
});

function isPublishFailureLine(call: unknown[]): boolean {
	const [line] = call;
	return typeof line === 'string' && line.includes('"message":"realtime_publish_failed"');
}
