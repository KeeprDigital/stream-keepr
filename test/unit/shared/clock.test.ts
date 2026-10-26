import type { ClockState } from '~~/shared/types/featureMatchState';
import { describe, expect, it } from 'vitest';
import {
	applyClockAdjustment,
	formatClockTime,
	getEffectiveElapsedMs,
	normalizeTimeInput,
	parseTimeInput,
} from '~~/shared/utils/clock';

describe('formatClockTime', () => {
	it.each([
		[0, '0:00'],
		[30_000, '0:30'],
		[61_000, '1:01'],
		[150_000, '2:30'],
		[1_999, '0:01'],
		[3_600_000, '1:00:00'],
		[3_661_000, '1:01:01'],
	])('formats %i ms as %s', (ms, expected) => {
		expect(formatClockTime(ms)).toBe(expected);
	});
});

describe('normalizeTimeInput', () => {
	it.each([
		['12:34', '12:34'],
		['1:23:45', '1:23:45'],
		['75:00', '75:00'],
		['5', '5:00'],
		['45', '45:00'],
		['530', '05:30'],
		['1234', '12:34'],
		['12345', '1:23:45'],
		['123456', '12:34:56'],
		['12.34', '12:34'],
	])('reads %j as %s', (input, expected) => {
		expect(normalizeTimeInput(input)).toBe(expected);
	});

	it.each([
		'',
		'   ',
		'1234567',
		'5:60',
		'5:99',
		'1:23:99',
		'1:60:00',
		'1:99:00',
	])('refuses %j', (input) => {
		expect(normalizeTimeInput(input)).toBeNull();
	});
});

describe('normalizeTimeInput and parseTimeInput agree', () => {
	it('accepts every string normalizeTimeInput returns as canonical', () => {
		const inputs: string[] = [
			'5:',
			':5',
			'5::5',
			' 12:34 ',
			'0:00',
			'00:00',
			'005:009',
			'abc',
			'5.99',
			'1:23:45:67',
			'99999999999999999999:00',
		];
		for (let minutes = 0; minutes <= 70; minutes += 1) {
			for (let seconds = 0; seconds <= 70; seconds += 7) {
				inputs.push(`${minutes}:${seconds}`);
				inputs.push(`${minutes}:${String(seconds).padStart(2, '0')}`);
			}
		}
		for (const hours of [0, 1, 12, 99]) {
			for (let minutes = 0; minutes <= 70; minutes += 7) {
				for (let seconds = 0; seconds <= 70; seconds += 7) {
					inputs.push(`${hours}:${minutes}:${seconds}`);
				}
			}
		}
		for (const digits of [
			'0',
			'9',
			'59',
			'60',
			'99',
			'099',
			'559',
			'599',
			'1234',
			'1299',
			'5999',
			'12345',
			'19999',
			'123456',
			'129999',
			'1234567',
		]) {
			inputs.push(digits);
		}

		for (const input of inputs) {
			const normalized = normalizeTimeInput(input);
			if (normalized !== null) {
				expect(parseTimeInput(normalized), `normalizeTimeInput(${JSON.stringify(input)}) -> ${JSON.stringify(normalized)} must be parseable`).not.toBeNull();
			}
		}
	});
});

describe('parseTimeInput', () => {
	it.each([
		['2:30', 150_000],
		['1:00:00', 3_600_000],
		['45', 2_700_000],
		['', null],
		['abc', null],
	])('reads %j as %s ms', (input, expected) => {
		expect(parseTimeInput(input)).toBe(expected);
	});
});

describe('getEffectiveElapsedMs', () => {
	it('returns elapsedMs when clock is stopped', () => {
		const clock: ClockState = {
			type: 'countdown',
			durationMs: 300_000,
			elapsedMs: 60_000,
			isRunning: false,
			lastStartedAt: null,
			countUpAfterCountdown: false,
		};
		expect(getEffectiveElapsedMs(clock, Date.now())).toBe(60_000);
	});

	it('adds running time when clock is running', () => {
		const now = 1_000_000;
		const clock: ClockState = {
			type: 'countdown',
			durationMs: 300_000,
			elapsedMs: 60_000,
			isRunning: true,
			lastStartedAt: now - 10_000,
			countUpAfterCountdown: false,
		};
		expect(getEffectiveElapsedMs(clock, now)).toBe(70_000);
	});

	it('returns 0 minimum (never negative)', () => {
		const clock: ClockState = {
			type: 'countdown',
			durationMs: 300_000,
			elapsedMs: -100,
			isRunning: false,
			lastStartedAt: null,
			countUpAfterCountdown: false,
		};
		expect(getEffectiveElapsedMs(clock, Date.now())).toBe(0);
	});
});

describe('applyClockAdjustment', () => {
	const now = 1_000_000;

	it('adjusts countdown clock by delta', () => {
		const clock: ClockState = {
			type: 'countdown',
			durationMs: 300_000,
			elapsedMs: 60_000,
			isRunning: false,
			lastStartedAt: null,
			countUpAfterCountdown: false,
		};

		const result = applyClockAdjustment(clock, now, { deltaDisplayMs: 30_000 });

		// Display was 240000 (300000-60000), add 30000 = 270000 display
		// New durationMs = elapsedMs + targetDisplayMs = 60000 + 270000 = 330000
		expect(result.durationMs).toBe(330_000);
		expect(result.elapsedMs).toBe(60_000);
	});

	it('adjusts countup clock by delta', () => {
		const clock: ClockState = {
			type: 'countup',
			durationMs: 0,
			elapsedMs: 60_000,
			isRunning: false,
			lastStartedAt: null,
			countUpAfterCountdown: false,
		};

		const result = applyClockAdjustment(clock, now, { deltaDisplayMs: 10_000 });
		expect(result.elapsedMs).toBe(70_000);
	});

	it('sets countdown clock to absolute target', () => {
		const clock: ClockState = {
			type: 'countdown',
			durationMs: 300_000,
			elapsedMs: 60_000,
			isRunning: false,
			lastStartedAt: null,
			countUpAfterCountdown: false,
		};

		const result = applyClockAdjustment(clock, now, { targetDisplayMs: 200_000 });
		expect(result.durationMs).toBe(260_000); // 60000 + 200000
	});

	it('clamps display to zero minimum', () => {
		const clock: ClockState = {
			type: 'countdown',
			durationMs: 300_000,
			elapsedMs: 60_000,
			isRunning: false,
			lastStartedAt: null,
			countUpAfterCountdown: false,
		};

		const result = applyClockAdjustment(clock, now, { targetDisplayMs: -100 });
		expect(result.durationMs).toBe(60_000); // elapsedMs + 0
	});

	it('updates lastStartedAt when clock is running', () => {
		const clock: ClockState = {
			type: 'countdown',
			durationMs: 300_000,
			elapsedMs: 60_000,
			isRunning: true,
			lastStartedAt: now - 5_000,
			countUpAfterCountdown: false,
		};

		const result = applyClockAdjustment(clock, now, { deltaDisplayMs: 10_000 });
		expect(result.lastStartedAt).toBe(now);
		expect(result.isRunning).toBe(true);
	});
});
