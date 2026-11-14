import type { ClockState } from '~~/shared/types/featureMatchState';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';

mockNuxtImport('useServerTime', () => () => ({
	isSynced: ref(true),
	serverTimeOffset: ref(0),
	getServerTime: () => Date.now(),
}));

const eventStore = reactive({
	displayEvent: { featureMatchDefaultUntimedLabel: '' },
});
mockNuxtImport('useEventStore', () => () => eventStore);

function clock(overrides: Partial<ClockState> = {}): ClockState {
	return {
		type: 'countdown',
		durationMs: 3_000_000,
		elapsedMs: 0,
		isRunning: false,
		lastStartedAt: null,
		countUpAfterCountdown: false,
		...overrides,
	};
}

describe('useClockDisplay', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	// What it shows and whether it has run out are the clock's projection, each
	// answered anew as it changes; when that is, is the scheduler's own test.
	it('counts a running countdown down to its end, reading expired as it shows 0:00', async () => {
		vi.useFakeTimers({ now: 1_000_000 });
		const display = useClockDisplay(clock({ durationMs: 2000, isRunning: true, lastStartedAt: 1_000_000 }));
		const shown = () => [display.displayTime.value, display.isExpired.value];
		expect(shown()).toEqual(['0:02', false]);

		await vi.advanceTimersByTimeAsync(1000);
		expect(shown()).toEqual(['0:01', false]);

		await vi.advanceTimersByTimeAsync(1000);
		expect(shown()).toEqual(['0:00', true]);
	});

	it.each([
		[
			'blank',
			'',
			{ displayTime: '', showsClock: false },
		],
		[
			'set',
			' Untimed ',
			{ displayTime: 'Untimed', showsClock: true },
		],
	])('shows an untimed match by its Untimed Label, with no clock while it is %s', (_, label, expected) => {
		eventStore.displayEvent.featureMatchDefaultUntimedLabel = label;
		const display = useClockDisplay(clock({ type: 'untimed' }));

		expect({ displayTime: display.displayTime.value, showsClock: display.showsClock.value }).toEqual(expected);
	});

	// Each colour and flag follows the projection's state; the states are its own test.
	it.each([
		[
			'stopped',
			clock(),
			{ isExpired: false, isInOvertime: false, color: 'text-muted' },
		],
		[
			'running',
			clock({ isRunning: true, lastStartedAt: Date.now() }),
			{ isExpired: false, isInOvertime: false, color: 'text-primary' },
		],
		[
			'paused',
			clock({ elapsedMs: 1000 }),
			{ isExpired: false, isInOvertime: false, color: 'text-warning' },
		],
		[
			'run out',
			clock({ durationMs: 10000, elapsedMs: 15000 }),
			{ isExpired: true, isInOvertime: false, color: 'text-error' },
		],
		[
			'counting up',
			clock({ durationMs: 10000, elapsedMs: 15000, countUpAfterCountdown: true }),
			{ isExpired: true, isInOvertime: true, color: 'text-error' },
		],
		[
			'holding at its count-up limit',
			clock({
				durationMs: 10000,
				elapsedMs: 15000,
				countUpAfterCountdown: true,
				countUpLimitMs: 2000,
			}),
			{ isExpired: true, isInOvertime: true, color: 'text-error' },
		],
	])('reads a %s clock', (_, state, expected) => {
		const display = useClockDisplay(state);

		expect({
			isExpired: display.isExpired.value,
			isInOvertime: display.isInOvertime.value,
			color: display.timeColorClass.value,
		}).toEqual(expected);
	});
});
