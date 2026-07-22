import type { ClockState } from '~~/shared/types/featureMatchState';
import { describe, expect, it } from 'vitest';
import { applyClockAdjustment, formatClockTime, getEffectiveElapsedMs, parseTimeInput } from '~~/shared/modules/feature-match-session';

function countdownClock(overrides: Partial<ClockState> = {}): ClockState {
	return {
		type: 'countdown',
		durationMs: 50 * 60 * 1000,
		elapsedMs: 0,
		isRunning: false,
		lastStartedAt: null,
		countUpAfterCountdown: false,
		...overrides,
	};
}

function countupClock(overrides: Partial<ClockState> = {}): ClockState {
	return {
		type: 'countup',
		durationMs: 0,
		elapsedMs: 0,
		isRunning: false,
		lastStartedAt: null,
		countUpAfterCountdown: false,
		...overrides,
	};
}

describe('clock rules', () => {
	it('formats and parses common broadcast time inputs', () => {
		expect(formatClockTime(50 * 60 * 1000)).toBe('50:00');
		expect(formatClockTime((1 * 60 * 60 + 2 * 60 + 3) * 1000)).toBe('1:02:03');

		expect(parseTimeInput('45')).toBe(45 * 60 * 1000);
		expect(parseTimeInput('530')).toBe((5 * 60 + 30) * 1000);
		expect(parseTimeInput('1:23:45')).toBe((1 * 60 * 60 + 23 * 60 + 45) * 1000);
		expect(parseTimeInput('1:99')).toBeNull();
	});

	it('computes effective elapsed time for a running clock at a fixed timestamp', () => {
		const clock = countdownClock({
			elapsedMs: 10_000,
			isRunning: true,
			lastStartedAt: 1_000,
		});

		expect(getEffectiveElapsedMs(clock, 6_000)).toBe(15_000);
	});

	it('adjusts countdown display time while preserving elapsed time semantics', () => {
		const clock = countdownClock({
			durationMs: 60_000,
			elapsedMs: 15_000,
		});

		const adjusted = applyClockAdjustment(clock, 10_000, { deltaDisplayMs: 5_000 });

		// Current display is 45s; adding 5s makes display 50s, represented as
		// elapsed + target display for countdown clocks.
		expect(adjusted).toMatchObject({
			durationMs: 65_000,
			elapsedMs: 15_000,
			lastStartedAt: null,
		});
	});

	it('adjusts countup display time directly', () => {
		const clock = countupClock({
			elapsedMs: 15_000,
			isRunning: true,
			lastStartedAt: 1_000,
		});

		const adjusted = applyClockAdjustment(clock, 6_000, { targetDisplayMs: 30_000 });

		expect(adjusted).toMatchObject({
			elapsedMs: 30_000,
			lastStartedAt: 6_000,
		});
	});
});
