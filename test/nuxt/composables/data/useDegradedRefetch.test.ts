import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDegradedRefetch } from '~/composables/data/useDegradedRefetch';
import { DECK_CARD_DATA_REFETCH_MS } from '~/composables/data/useScryfallBatch';

function harness(unchanged = true) {
	const refetch = vi.fn();
	const report = vi.fn();
	const lifecycle = useDegradedRefetch<string>({
		refetch,
		isUnchanged: () => unchanged,
		report,
	});
	return { lifecycle, refetch, report };
}

describe('useDegradedRefetch', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('renders a complete build and schedules nothing', () => {
		const { lifecycle, refetch, report } = harness();

		expect(lifecycle.completeLoad(false, 'deck')).toBe('render');
		vi.advanceTimersByTime(DECK_CARD_DATA_REFETCH_MS * 2);

		expect(lifecycle.degraded.value).toBe(false);
		expect(report).toHaveBeenLastCalledWith(false);
		expect(refetch).not.toHaveBeenCalled();
	});

	it('keeps an unchanged degraded rebuild on program and re-fetches on the cadence', () => {
		const { lifecycle, refetch, report } = harness(true);

		expect(lifecycle.completeLoad(true, 'deck')).toBe('keep');
		expect(lifecycle.degraded.value).toBe(true);
		expect(report).toHaveBeenLastCalledWith(true);

		vi.advanceTimersByTime(DECK_CARD_DATA_REFETCH_MS - 1);
		expect(refetch).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(refetch).toHaveBeenCalledOnce();
	});

	it('renders a degraded build of a changed source', () => {
		const { lifecycle } = harness(false);

		expect(lifecycle.completeLoad(true, 'other deck')).toBe('render');
	});

	it('keeps the cadence through a failed attempt only while degraded', () => {
		const { lifecycle, refetch } = harness();

		expect(lifecycle.keepCadence()).toBe(false);
		vi.advanceTimersByTime(DECK_CARD_DATA_REFETCH_MS);
		expect(refetch).not.toHaveBeenCalled();

		lifecycle.completeLoad(true, 'deck');
		vi.advanceTimersByTime(DECK_CARD_DATA_REFETCH_MS);
		expect(lifecycle.keepCadence()).toBe(true);
		vi.advanceTimersByTime(DECK_CARD_DATA_REFETCH_MS);
		expect(refetch).toHaveBeenCalledTimes(2);
	});

	it('supersedes the previous load and its pending re-fetch when a load begins', () => {
		const { lifecycle, refetch } = harness();
		const first = lifecycle.begin();
		lifecycle.completeLoad(true, 'deck');

		const second = lifecycle.begin();
		vi.advanceTimersByTime(DECK_CARD_DATA_REFETCH_MS);

		expect(first.stale).toBe(true);
		expect(second.current).toBe(true);
		expect(refetch).not.toHaveBeenCalled();
	});

	it('settles a cleared surface: no re-fetch, no load in flight, no degraded report', () => {
		const { lifecycle, refetch, report } = harness();
		const flight = lifecycle.begin();
		lifecycle.completeLoad(true, 'deck');

		lifecycle.settle();
		vi.advanceTimersByTime(DECK_CARD_DATA_REFETCH_MS);

		expect(flight.stale).toBe(true);
		expect(lifecycle.degraded.value).toBe(false);
		expect(report).toHaveBeenLastCalledWith(false);
		expect(refetch).not.toHaveBeenCalled();
	});

	it('cancels a pending re-fetch on teardown without touching the degraded flag', () => {
		const { lifecycle, refetch } = harness();
		lifecycle.completeLoad(true, 'deck');

		lifecycle.cancel();
		vi.advanceTimersByTime(DECK_CARD_DATA_REFETCH_MS);

		expect(lifecycle.degraded.value).toBe(true);
		expect(refetch).not.toHaveBeenCalled();
	});
});
