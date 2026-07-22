import type { ClockState } from '~~/shared/types/featureMatchState';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

mockNuxtImport('useServerTime', () => () => ({
	getServerTime: () => Date.now(),
}));

describe('useClockDisplay', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	function createClock(overrides: Partial<ClockState> = {}): ClockState {
		return {
			type: 'countdown',
			durationMs: 3_000_000, // 50 min
			elapsedMs: 0,
			isRunning: false,
			lastStartedAt: null,
			countUpAfterCountdown: false,
			...overrides,
		};
	}

	it('returns 0:00 when clock is null', () => {
		const { displayTime } = useClockDisplay(null);
		expect(displayTime.value).toBe('0:00');
	});

	it('shows full duration for a fresh countdown', () => {
		const clock = createClock({ durationMs: 3_000_000, elapsedMs: 0 });
		const { displayTime } = useClockDisplay(clock);
		expect(displayTime.value).toBe('50:00');
	});

	it('shows remaining time for a partially elapsed countdown', () => {
		const clock = createClock({ durationMs: 600_000, elapsedMs: 300_000 });
		const { displayTime } = useClockDisplay(clock);
		expect(displayTime.value).toBe('5:00');
	});

	it('shows elapsed time for a count-up clock', () => {
		const clock = createClock({ type: 'countup', elapsedMs: 90_000 });
		const { displayTime } = useClockDisplay(clock);
		expect(displayTime.value).toBe('1:30');
	});

	it('detects paused state', () => {
		const clock = createClock({ isRunning: false, elapsedMs: 10000 });
		const { isPaused } = useClockDisplay(clock);
		expect(isPaused.value).toBe(true);
	});

	it('detects expired countdown', () => {
		const clock = createClock({ durationMs: 10000, elapsedMs: 15000 });
		const { isExpired } = useClockDisplay(clock);
		expect(isExpired.value).toBe(true);
	});

	it('detects overtime state', () => {
		const clock = createClock({
			durationMs: 10000,
			elapsedMs: 15000,
			countUpAfterCountdown: true,
		});
		const { isInOvertime } = useClockDisplay(clock);
		expect(isInOvertime.value).toBe(true);
	});

	it('returns correct time color class for running clock', () => {
		const clock = createClock({ isRunning: true });
		const { timeColorClass } = useClockDisplay(clock);
		expect(timeColorClass.value).toBe('text-primary');
	});

	it('returns correct time color class for paused clock', () => {
		const clock = createClock({ isRunning: false, elapsedMs: 1000 });
		const { timeColorClass } = useClockDisplay(clock);
		expect(timeColorClass.value).toBe('text-warning');
	});

	it('returns expired color class for expired clock', () => {
		const clock = createClock({ durationMs: 10000, elapsedMs: 15000 });
		const { timeColorClass } = useClockDisplay(clock);
		expect(timeColorClass.value).toBe('text-error');
	});

	it('computes getElapsedMs correctly', () => {
		const clock = createClock({ elapsedMs: 5000 });
		const { getElapsedMs } = useClockDisplay(clock);
		expect(getElapsedMs()).toBe(5000);
	});

	it('computes getRemainingMs correctly', () => {
		const clock = createClock({ durationMs: 10000, elapsedMs: 3000 });
		const { getRemainingMs } = useClockDisplay(clock);
		expect(getRemainingMs()).toBe(7000);
	});
});
