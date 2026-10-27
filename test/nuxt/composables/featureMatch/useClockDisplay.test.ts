import type { ClockState } from '~~/shared/types/featureMatchState';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import { reactive } from 'vue';

mockNuxtImport('useServerTime', () => () => ({
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
	it.each([
		['no clock', null, '0:00'],
		[
			'a fresh countdown',
			clock(),
			'50:00',
		],
		[
			'a countdown half run',
			clock({ durationMs: 600_000, elapsedMs: 300_000 }),
			'5:00',
		],
		[
			'a count-up clock',
			clock({ type: 'countup', elapsedMs: 90_000 }),
			'1:30',
		],
	])('shows %s as %s', (_, state, expected) => {
		expect(useClockDisplay(state).displayTime.value).toBe(expected);
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

	it.each([
		[
			'running',
			clock({ isRunning: true }),
			{
				isPaused: false,
				isExpired: false,
				isInOvertime: false,
				color: 'text-primary',
			},
		],
		[
			'paused',
			clock({ elapsedMs: 1000 }),
			{
				isPaused: true,
				isExpired: false,
				isInOvertime: false,
				color: 'text-warning',
			},
		],
		[
			'expired',
			clock({ durationMs: 10000, elapsedMs: 15000 }),
			{
				isPaused: true,
				isExpired: true,
				isInOvertime: false,
				color: 'text-error',
			},
		],
		[
			'in overtime',
			clock({ durationMs: 10000, elapsedMs: 15000, countUpAfterCountdown: true }),
			{ isInOvertime: true },
		],
	])('reads a %s clock', (_, state, expected) => {
		const display = useClockDisplay(state);

		expect({
			isPaused: display.isPaused.value,
			isExpired: display.isExpired.value,
			isInOvertime: display.isInOvertime.value,
			color: display.timeColorClass.value,
		}).toMatchObject(expected);
	});

	it('counts elapsed and remaining time', () => {
		const display = useClockDisplay(clock({ durationMs: 10000, elapsedMs: 3000 }));

		expect(display.getElapsedMs()).toBe(3000);
		expect(display.getRemainingMs()).toBe(7000);
	});
});
