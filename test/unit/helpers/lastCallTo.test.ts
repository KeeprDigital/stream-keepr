import { describe, expect, it, vi } from 'vitest';
import { callsTo, lastCallTo } from '~~/test/helpers/lastCallTo';

// A shared helper's defect reaches every site at once. Each case puts a stray call
// after the one under test, which a helper that only guards emptiness would return.

const LEDGER = '/api/admin/graphics-assets/evidence';
const CLOCK = '/api/time';

function recordedFetch() {
	const mock = vi.fn();
	mock(LEDGER, {
		query: { page: 1 },
	});
	mock(LEDGER, {
		query: { page: 2 },
	});
	mock(CLOCK, { retry: 1 });
	return mock;
}

function isPublishFailureLine(call: unknown[]): boolean {
	const [line] = call;
	return typeof line === 'string' && line.includes('"message":"realtime_publish_failed"');
}

describe('lastCallTo', () => {
	it('takes the last call to the named endpoint, not the last call', () => {
		const [, options] = lastCallTo(recordedFetch(), LEDGER);

		expect(options).toEqual({
			query: { page: 2 },
		});
	});

	it('selects by matcher for subjects whose first argument is not a name', () => {
		const spy = vi.fn();
		spy(JSON.stringify({ message: 'realtime_publish_failed', eventId: 7 }));
		spy(JSON.stringify({ message: 'realtime_publish_oversized', eventId: 7 }));

		const [line] = lastCallTo(spy, isPublishFailureLine);

		expect(JSON.parse(line as string)).toEqual({ message: 'realtime_publish_failed', eventId: 7 });
	});

	it('takes the last call when there is no selector', () => {
		const projection = vi.fn();
		projection({ nextSequence: 1 });
		projection({ nextSequence: 2 });

		expect(lastCallTo(projection)[0]).toEqual({ nextSequence: 2 });
	});

	it('refuses an endpoint nothing called rather than handing back a stray, and lists what arrived', () => {
		expect(() => lastCallTo(recordedFetch(), '/api/other'))
			.toThrow(`expected a call to /api/other, got only ["${LEDGER}", "${LEDGER}", "${CLOCK}"]`);
	});
});

// A destructured pair compared to itself passes vacuously when the list is short.
describe('callsTo', () => {
	it('hands back exactly the selected calls, in order', () => {
		const [first, second] = callsTo(recordedFetch(), 2, LEDGER);

		expect(first?.[1]).toEqual({
			query: { page: 1 },
		});
		expect(second?.[1]).toEqual({
			query: { page: 2 },
		});
	});

	it.each([
		[
			'shorter',
			() => {
				const mock = vi.fn();
				mock(LEDGER, {
					query: { page: 1 },
				});
				return callsTo(mock, 2, LEDGER);
			},
			`expected 2 calls to ${LEDGER}, got 1; recorded only ["${LEDGER}"]`,
		],
		[
			'longer',
			() => callsTo(recordedFetch(), 2),
			'expected 2 calls, got 3; recorded only',
		],
	])('refuses a list %s than the test expects', (_, read, message) => {
		expect(read).toThrow(message);
	});
});
