import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatSyncTimestamp } from '~~/app/utils/meleeSync';

/**
 * The relative-time ladder every surface that shows a sync time now reads from.
 *
 * It was two ladders until #329: this one, and a byte-near copy inside
 * `Round/ListItem.vue` that differed only at the bottom two rungs ('just now'
 * against 'Just now', '' against 'Never'). Consolidating gave the survivor a second
 * consumer and no coverage of its own — its rungs were reachable only through two
 * component suites, and 'Never' through neither, since the Round row renders its
 * badge under `v-if="round.lastSyncedAt"`.
 *
 * On frozen time, because every rung here is a boundary and a real clock makes the
 * ones at 59s and 59m a race against the test's own elapsed milliseconds.
 */
describe('formatSyncTimestamp', () => {
	const now = new Date('2026-06-01T12:00:00Z');

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(now);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	function ago(ms: number) {
		return new Date(now.getTime() - ms);
	}

	const MINUTE = 60_000;
	const HOUR = 60 * MINUTE;

	it.each([null, undefined])('says Never rather than nothing when handed %s', (absent) => {
		// The empty string the Round row's own copy answered here read on screen as a
		// badge saying 'Synced' and then stopping.
		expect(formatSyncTimestamp(absent)).toBe('Never');
	});

	it('says Just now right up to the minute', () => {
		expect(formatSyncTimestamp(now)).toBe('Just now');
		expect(formatSyncTimestamp(ago(MINUTE - 1))).toBe('Just now');
	});

	it('counts minutes from the minute to the hour', () => {
		expect(formatSyncTimestamp(ago(MINUTE))).toBe('1m ago');
		expect(formatSyncTimestamp(ago(HOUR - 1))).toBe('59m ago');
	});

	it('counts hours from the hour to the day', () => {
		expect(formatSyncTimestamp(ago(HOUR))).toBe('1h ago');
		expect(formatSyncTimestamp(ago(2 * HOUR + 5 * MINUTE))).toBe('2h ago');
		expect(formatSyncTimestamp(ago(24 * HOUR - 1))).toBe('23h ago');
	});

	it('falls back to a date once a day has passed', () => {
		expect(formatSyncTimestamp(ago(24 * HOUR))).toBe(ago(24 * HOUR).toLocaleDateString());
	});

	/**
	 * The shape production actually delivers. Every consumer reads a timestamp that has
	 * been through `JSON.stringify`, so the `Date` its callers' types promise arrives as
	 * an ISO string — which is what #291 found the Round row's local copy throwing on
	 * (`d.getTime is not a function`) while nine tests passed on fixtures that handed it
	 * a real `Date`.
	 */
	it('reads the ISO string the wire delivers, not only a Date', () => {
		expect(formatSyncTimestamp(ago(2 * HOUR).toISOString())).toBe('2h ago');
	});
});
