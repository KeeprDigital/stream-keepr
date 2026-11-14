import type { ClockState } from '~~/shared/types/featureMatchState';
import type { FeatureMatchClock } from '~~/shared/utils/clock';
import { describe, expect, it } from 'vitest';
import {
	applyClockAdjustment,
	clockTransitions,
	formatClockTime,
	formatCountdownTime,
	getEffectiveElapsedMs,
	normalizeTimeInput,
	parseTimeInput,
	projectFeatureMatchClock,
	readStoredClock,
	writeStoredClock,
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

// A countdown rounds the time remaining up: it reads its full duration through
// its first second and 0:00 only once nothing remains (ADR-0078).
describe('formatCountdownTime', () => {
	it.each([
		[3_000_000, '50:00'],
		[2_999_999, '50:00'],
		[2_999_001, '50:00'],
		[2_999_000, '49:59'],
		[3_599_001, '1:00:00'],
		[59_001, '1:00'],
		[1_001, '0:02'],
		[1_000, '0:01'],
		[1, '0:01'],
		[0, '0:00'],
		[-1, '0:00'],
	])('formats %i ms remaining as %s', (ms, expected) => {
		expect(formatCountdownTime(ms)).toBe(expected);
	});
});

describe('projectFeatureMatchClock: what it shows', () => {
	const NOW = 1_000_000;
	const clock = (overrides: Partial<FeatureMatchClock>): FeatureMatchClock => ({
		type: 'countdown',
		durationMs: 600_000,
		elapsedMs: 0,
		startedAt: null,
		countUpAfterCountdown: false,
		countUpLimitMs: null,
		...overrides,
	});

	it.each([
		{
			name: 'no clock',
			state: null,
			label: '',
			expected: '0:00',
		},
		{
			name: 'a countdown with time left',
			state: clock({ elapsedMs: 300_000 }),
			label: '',
			expected: '5:00',
		},
		{
			name: 'a running countdown, by now',
			state: clock({ startedAt: NOW - 90_000 }),
			label: '',
			expected: '8:30',
		},
		{
			name: 'an expired countdown',
			state: clock({ elapsedMs: 700_000 }),
			label: '',
			expected: '0:00',
		},
		{
			name: 'an expired countdown that counts up after',
			state: clock({ elapsedMs: 700_000, countUpAfterCountdown: true }),
			label: '',
			expected: '1:40',
		},
		{
			name: 'an expired countdown short of its count-up limit',
			state: clock({ elapsedMs: 700_000, countUpAfterCountdown: true, countUpLimitMs: 120_000 }),
			label: '',
			expected: '1:40',
		},
		{
			name: 'an expired countdown past its count-up limit, held there',
			state: clock({ elapsedMs: 900_000, countUpAfterCountdown: true, countUpLimitMs: 120_000 }),
			label: '',
			expected: '2:00',
		},
		{
			name: 'an expired countdown with no count-up limit',
			state: clock({ elapsedMs: 900_000, countUpAfterCountdown: true, countUpLimitMs: null }),
			label: '',
			expected: '5:00',
		},
		{
			name: 'a count-up clock',
			state: clock({ type: 'countup', elapsedMs: 90_000 }),
			label: '',
			expected: '1:30',
		},
		// Time remaining rounds up; elapsed time and overtime round down (ADR-0078).
		{
			name: 'a running countdown the instant it starts',
			state: clock({ startedAt: NOW }),
			label: '',
			expected: '10:00',
		},
		{
			name: 'a running countdown a millisecond short of its first second',
			state: clock({ startedAt: NOW - 999 }),
			label: '',
			expected: '10:00',
		},
		{
			name: 'a running countdown one second in',
			state: clock({ startedAt: NOW - 1000 }),
			label: '',
			expected: '9:59',
		},
		{
			name: 'a paused countdown part-way through a second',
			state: clock({ elapsedMs: 300_400 }),
			label: '',
			expected: '5:00',
		},
		{
			name: 'a countdown with a millisecond left',
			state: clock({ elapsedMs: 599_999 }),
			label: '',
			expected: '0:01',
		},
		{
			name: 'a countdown the instant it runs out',
			state: clock({ elapsedMs: 600_000 }),
			label: '',
			expected: '0:00',
		},
		{
			name: 'a countdown that counts up after, the instant it runs out',
			state: clock({ elapsedMs: 600_000, countUpAfterCountdown: true }),
			label: '',
			expected: '0:00',
		},
		{
			name: 'overtime a millisecond short of its first second',
			state: clock({ elapsedMs: 600_999, countUpAfterCountdown: true }),
			label: '',
			expected: '0:00',
		},
		{
			name: 'overtime one second in',
			state: clock({ elapsedMs: 601_000, countUpAfterCountdown: true }),
			label: '',
			expected: '0:01',
		},
		{
			name: 'overtime a millisecond short of its count-up limit',
			state: clock({ elapsedMs: 719_999, countUpAfterCountdown: true, countUpLimitMs: 120_000 }),
			label: '',
			expected: '1:59',
		},
		{
			name: 'a count-up clock part-way through a second',
			state: clock({ type: 'countup', elapsedMs: 90_999 }),
			label: '',
			expected: '1:30',
		},
		{
			name: 'an untimed clock',
			state: clock({ type: 'untimed' }),
			label: ' Untimed ',
			expected: 'Untimed',
		},
		{
			name: 'an untimed clock with a blank label',
			state: clock({ type: 'untimed' }),
			label: '',
			expected: '',
		},
	])('shows $name as "$expected"', ({ state, label, expected }) => {
		expect(projectFeatureMatchClock(state, NOW, label).display).toBe(expected);
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
		const clock: FeatureMatchClock = {
			type: 'countdown',
			durationMs: 300_000,
			elapsedMs: 60_000,
			startedAt: null,
			countUpAfterCountdown: false,
			countUpLimitMs: null,
		};
		expect(getEffectiveElapsedMs(clock, Date.now())).toBe(60_000);
	});

	it('adds running time when clock is running', () => {
		const now = 1_000_000;
		const clock: FeatureMatchClock = {
			type: 'countdown',
			durationMs: 300_000,
			elapsedMs: 60_000,
			startedAt: now - 10_000,
			countUpAfterCountdown: false,
			countUpLimitMs: null,
		};
		expect(getEffectiveElapsedMs(clock, now)).toBe(70_000);
	});

	it('returns 0 minimum (never negative)', () => {
		const clock: FeatureMatchClock = {
			type: 'countdown',
			durationMs: 300_000,
			elapsedMs: -100,
			startedAt: null,
			countUpAfterCountdown: false,
			countUpLimitMs: null,
		};
		expect(getEffectiveElapsedMs(clock, Date.now())).toBe(0);
	});
});

describe('applyClockAdjustment', () => {
	const now = 1_000_000;

	it('adjusts countdown clock by delta', () => {
		const clock: FeatureMatchClock = {
			type: 'countdown',
			durationMs: 300_000,
			elapsedMs: 60_000,
			startedAt: null,
			countUpAfterCountdown: false,
			countUpLimitMs: null,
		};

		const result = applyClockAdjustment(clock, now, { deltaDisplayMs: 30_000 });

		// Display was 240000 (300000-60000), add 30000 = 270000 display
		// New durationMs = elapsedMs + targetDisplayMs = 60000 + 270000 = 330000
		expect(result.durationMs).toBe(330_000);
		expect(result.elapsedMs).toBe(60_000);
	});

	it('adjusts countup clock by delta', () => {
		const clock: FeatureMatchClock = {
			type: 'countup',
			durationMs: 0,
			elapsedMs: 60_000,
			startedAt: null,
			countUpAfterCountdown: false,
			countUpLimitMs: null,
		};

		const result = applyClockAdjustment(clock, now, { deltaDisplayMs: 10_000 });
		expect(result.elapsedMs).toBe(70_000);
	});

	it('sets countdown clock to absolute target', () => {
		const clock: FeatureMatchClock = {
			type: 'countdown',
			durationMs: 300_000,
			elapsedMs: 60_000,
			startedAt: null,
			countUpAfterCountdown: false,
			countUpLimitMs: null,
		};

		const result = applyClockAdjustment(clock, now, { targetDisplayMs: 200_000 });
		expect(result.durationMs).toBe(260_000); // 60000 + 200000
	});

	it('clamps display to zero minimum', () => {
		const clock: FeatureMatchClock = {
			type: 'countdown',
			durationMs: 300_000,
			elapsedMs: 60_000,
			startedAt: null,
			countUpAfterCountdown: false,
			countUpLimitMs: null,
		};

		const result = applyClockAdjustment(clock, now, { targetDisplayMs: -100 });
		expect(result.durationMs).toBe(60_000); // elapsedMs + 0
	});

	it('runs a running clock from the instant of the adjustment', () => {
		const clock: FeatureMatchClock = {
			type: 'countdown',
			durationMs: 300_000,
			elapsedMs: 60_000,
			startedAt: now - 5_000,
			countUpAfterCountdown: false,
			countUpLimitMs: null,
		};

		const result = applyClockAdjustment(clock, now, { deltaDisplayMs: 10_000 });
		expect(result.startedAt).toBe(now);
	});
});

// A delta moves a countdown's end: + gives time back, − takes it away. Past the
// end that is overtime shrinking or growing, never a reset to 0:00 (#1025).
describe('applyClockAdjustment on a countdown counting up past its end', () => {
	const now = 1_000_000;
	const MINUTE = 60_000;
	function overtimeClock(overtimeMs: number, overrides: Partial<FeatureMatchClock> = {}): FeatureMatchClock {
		return {
			type: 'countdown',
			durationMs: 10 * MINUTE,
			elapsedMs: 10 * MINUTE + overtimeMs,
			startedAt: null,
			countUpAfterCountdown: true,
			countUpLimitMs: null,
			...overrides,
		};
	}
	function expired(clock: FeatureMatchClock) {
		return getEffectiveElapsedMs(clock, now) >= clock.durationMs;
	}

	it.each([
		{
			name: '−1:00 on 3:00 of overtime lengthens it',
			overtimeMs: 3 * MINUTE,
			deltaMs: -MINUTE,
			shows: '4:00',
			inOvertime: true,
		},
		{
			name: '+1:00 on 3:00 of overtime shortens it',
			overtimeMs: 3 * MINUTE,
			deltaMs: MINUTE,
			shows: '2:00',
			inOvertime: true,
		},
		{
			name: '+3:00 on 3:00 of overtime lands on the end',
			overtimeMs: 3 * MINUTE,
			deltaMs: 3 * MINUTE,
			shows: '0:00',
			inOvertime: true,
		},
		{
			name: '+5:00 on 3:00 of overtime returns to a countdown',
			overtimeMs: 3 * MINUTE,
			deltaMs: 5 * MINUTE,
			shows: '2:00',
			inOvertime: false,
		},
		// Overtime rounds down and time remaining up, so the shown time moves by the delta exactly.
		{
			name: '+5:00 on 3:00 of overtime, part-way through a second, returns to 2:00',
			overtimeMs: 3 * MINUTE + 400,
			deltaMs: 5 * MINUTE,
			shows: '2:00',
			inOvertime: false,
		},
		{
			name: '−15:00, more than the clock has run, still lengthens it',
			overtimeMs: 3 * MINUTE,
			deltaMs: -15 * MINUTE,
			shows: '18:00',
			inOvertime: true,
		},
		{
			name: '+1:00 on a clock holding at its limit shortens what it shows',
			overtimeMs: 9 * MINUTE,
			limitMs: 5 * MINUTE,
			deltaMs: MINUTE,
			shows: '4:00',
			inOvertime: true,
		},
	])('$name', ({ overtimeMs, limitMs, deltaMs, shows, inOvertime }) => {
		const result = applyClockAdjustment(overtimeClock(overtimeMs, { countUpLimitMs: limitMs }), now, { deltaDisplayMs: deltaMs });

		expect(projectFeatureMatchClock(result, now, '').display).toBe(shows);
		expect(expired(result)).toBe(inOvertime);
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
	});

	it.each([
		{
			name: 'a running clock keeps running from the adjusted overtime',
			clock: overtimeClock(2 * MINUTE, { startedAt: now - MINUTE }),
			adjustment: { deltaDisplayMs: -MINUTE },
			shows: '4:00',
		},
		{
			name: 'a set-to still sets a countdown of that length',
			clock: overtimeClock(3 * MINUTE),
			adjustment: { targetDisplayMs: 2 * MINUTE },
			shows: '2:00',
			countsDown: true,
		},
		{
			name: 'a clock that holds 0:00 after its end still counts down from a +',
			clock: overtimeClock(3 * MINUTE, { countUpAfterCountdown: false }),
			adjustment: { deltaDisplayMs: MINUTE },
			shows: '1:00',
			countsDown: true,
		},
		{
			name: 'a + part-way through a second moves the shown time by exactly that',
			clock: overtimeClock(-90_400, { countUpAfterCountdown: false }),
			adjustment: { deltaDisplayMs: MINUTE },
			shows: '2:31',
			countsDown: true,
		},
		{
			name: 'a set-to on a running clock shows that time through its first second',
			clock: overtimeClock(-90_400, { startedAt: now - 999 }),
			adjustment: { targetDisplayMs: 2 * MINUTE },
			shows: '2:00',
			countsDown: true,
		},
		{
			name: 'a − before the end stops at the end',
			clock: overtimeClock(-30_000),
			adjustment: { deltaDisplayMs: -MINUTE },
			shows: '0:00',
		},
	])('$name', ({ clock, adjustment, shows, countsDown }) => {
		const result = applyClockAdjustment(clock, now, adjustment);

		expect(projectFeatureMatchClock(result, now, '').display).toBe(shows);
		if (countsDown)
			expect(expired(result)).toBe(false);
	});
});

describe('projectFeatureMatchClock: when what it shows next changes', () => {
	const NOW = 1_000_000;
	function running(overrides: Partial<FeatureMatchClock>, elapsedMs: number): FeatureMatchClock {
		return {
			type: 'countdown',
			durationMs: 60_000,
			elapsedMs: 0,
			startedAt: NOW - elapsedMs,
			countUpAfterCountdown: false,
			countUpLimitMs: null,
			...overrides,
		};
	}

	// Waking at the named moment shows a new time, and a millisecond sooner the old one.
	it.each([
		[
			'a count-up part-way through a second',
			running({ type: 'countup' }, 12_900),
		],
		[
			'a count-up on a whole second',
			running({ type: 'countup' }, 13_000),
		],
		[
			'a countdown the instant it starts',
			running({}, 0),
		],
		[
			'a countdown part-way through a second',
			running({}, 12_900),
		],
		[
			'a countdown on a whole second',
			running({}, 13_000),
		],
		[
			'a countdown a millisecond past a whole second',
			running({}, 13_001),
		],
		[
			'a countdown of an odd length',
			running({ durationMs: 60_400 }, 12_900),
		],
		[
			'a countdown with exactly a second left',
			running({}, 59_000),
		],
		[
			'a countdown in its last second',
			running({}, 59_500),
		],
		[
			'a countdown with a millisecond left',
			running({}, 59_999),
		],
		[
			'a countdown in its last second that counts up after',
			running({ countUpAfterCountdown: true }, 59_500),
		],
		[
			'a countdown the instant it runs out and counts up',
			running({ countUpAfterCountdown: true }, 60_000),
		],
		[
			'a countdown in overtime',
			running({ countUpAfterCountdown: true }, 61_300),
		],
		[
			'overtime in the last second before its limit',
			running({ countUpAfterCountdown: true, countUpLimitMs: 5_000 }, 64_300),
		],
	])('names exactly when the display of %s changes', (_case, clock) => {
		const { display, nextChangeInMs } = projectFeatureMatchClock(clock, NOW, '');

		expect(projectFeatureMatchClock(clock, NOW + nextChangeInMs! - 1, '').display).toBe(display);
		expect(projectFeatureMatchClock(clock, NOW + nextChangeInMs!, '').display).not.toBe(display);
	});

	// A countdown changes as each whole second of time remaining is reached, its
	// last at the end itself; elapsed time and overtime change on the whole second.
	it.each([
		[
			'a countdown the instant it starts',
			running({}, 0),
			1000,
		],
		[
			'a countdown part-way through a second',
			running({}, 12_900),
			100,
		],
		[
			'a countdown on a whole second',
			running({}, 13_000),
			1000,
		],
		[
			'a countdown in its last second',
			running({}, 59_500),
			500,
		],
		[
			'a countdown in its last second that counts up after',
			running({ countUpAfterCountdown: true }, 59_500),
			500,
		],
		[
			'a countdown the instant it runs out and counts up',
			running({ countUpAfterCountdown: true }, 60_000),
			1000,
		],
		[
			'a countdown in overtime',
			running({ countUpAfterCountdown: true }, 61_300),
			700,
		],
		[
			'a count-up part-way through a second',
			running({ type: 'countup' }, 12_900),
			100,
		],
	])('names when the display of %s changes', (_case, clock, expected) => {
		expect(projectFeatureMatchClock(clock, NOW, '').nextChangeInMs).toBe(expected);
	});

	// Counting up after, 0:00 shows for one second: from the end through the first second of overtime.
	it.each([
		[-1, '0:01'],
		[0, '0:00'],
		[999, '0:00'],
		[1000, '0:01'],
	])('a countdown that counts up after shows, %i ms from its end, %s', (fromEnd, expected) => {
		const clock = running({ countUpAfterCountdown: true }, 60_000 + fromEnd);

		expect(projectFeatureMatchClock(clock, NOW, '').display).toBe(expected);
	});

	it.each([
		['no clock', null],
		[
			'an untimed clock',
			running({ type: 'untimed' }, 5_000),
		],
		[
			'a stopped clock',
			{
				...running({}, 5_000),
				startedAt: null,
			},
		],
		[
			'a countdown the instant it runs out, not counting up',
			running({}, 60_000),
		],
		[
			'a countdown that ran out and does not count up',
			running({}, 61_000),
		],
		[
			'overtime the instant it reaches its limit',
			running({ countUpAfterCountdown: true, countUpLimitMs: 5_000 }, 65_000),
		],
		[
			'overtime holding at its limit',
			running({ countUpAfterCountdown: true, countUpLimitMs: 5_000 }, 70_000),
		],
	])('names no change for %s', (_case, clock) => {
		expect(projectFeatureMatchClock(clock, NOW, '').nextChangeInMs).toBeNull();
	});
});

describe('projectFeatureMatchClock: its state and its time', () => {
	const NOW = 1_000_000;
	const clock = (overrides: Partial<FeatureMatchClock>): FeatureMatchClock => ({
		type: 'countdown',
		durationMs: 60_000,
		elapsedMs: 0,
		startedAt: null,
		countUpAfterCountdown: false,
		countUpLimitMs: null,
		...overrides,
	});
	const running = (elapsedMs: number, overrides: Partial<FeatureMatchClock> = {}) =>
		clock({ startedAt: NOW - elapsedMs, ...overrides });

	// Where its time stands outranks whether it is counting: a clock that has run
	// out reads so running or stopped, told apart by whether it still runs, and
	// only a clock with time left reads paused.
	it.each([
		{
			name: 'no clock',
			state: null,
			expected: { state: 'stopped', elapsedMs: 0, remainingMs: null },
		},
		{
			name: 'an untimed clock',
			state: clock({ type: 'untimed' }),
			expected: { state: 'untimed', elapsedMs: 0, remainingMs: null },
		},
		{
			name: 'a countdown no time has run on',
			state: clock({}),
			expected: { state: 'stopped', elapsedMs: 0, remainingMs: 60_000 },
		},
		{
			name: 'a countdown stopped part-way',
			state: clock({ elapsedMs: 20_400 }),
			expected: { state: 'paused', elapsedMs: 20_400, remainingMs: 39_600 },
		},
		{
			name: 'a running countdown, by its stored time and the time since its start',
			state: running(12_000, { elapsedMs: 8_000 }),
			expected: { state: 'running', elapsedMs: 20_000, remainingMs: 40_000 },
		},
		{
			name: 'a running countdown with a millisecond left',
			state: running(59_999),
			expected: { state: 'running', elapsedMs: 59_999, remainingMs: 1 },
		},
		{
			name: 'a running countdown the instant it runs out',
			state: running(60_000),
			expected: {
				state: 'run-out',
				isRunning: true,
				elapsedMs: 60_000,
				remainingMs: 0,
			},
		},
		{
			name: 'a countdown stopped after it ran out',
			state: clock({ elapsedMs: 75_000 }),
			expected: {
				state: 'run-out',
				isRunning: false,
				elapsedMs: 75_000,
				remainingMs: 0,
			},
		},
		{
			name: 'a countdown that counts up after, the instant it runs out',
			state: running(60_000, { countUpAfterCountdown: true }),
			expected: { state: 'counting-up', elapsedMs: 60_000, remainingMs: 0 },
		},
		{
			name: 'overtime a millisecond short of its count-up limit',
			state: running(64_999, { countUpAfterCountdown: true, countUpLimitMs: 5_000 }),
			expected: { state: 'counting-up', elapsedMs: 64_999, remainingMs: 0 },
		},
		{
			name: 'overtime the instant it reaches its count-up limit',
			state: running(65_000, { countUpAfterCountdown: true, countUpLimitMs: 5_000 }),
			expected: { state: 'holding', elapsedMs: 65_000, remainingMs: 0 },
		},
		{
			name: 'overtime with no count-up limit',
			state: running(700_000, { countUpAfterCountdown: true, countUpLimitMs: null }),
			expected: { state: 'counting-up', elapsedMs: 700_000, remainingMs: 0 },
		},
		{
			name: 'a count-up clock stopped past its duration',
			state: clock({ type: 'countup', elapsedMs: 90_000 }),
			expected: { state: 'paused', elapsedMs: 90_000, remainingMs: null },
		},
		{
			name: 'a running count-up clock',
			state: running(90_000, { type: 'countup' }),
			expected: { state: 'running', elapsedMs: 90_000, remainingMs: null },
		},
		{
			name: 'a clock started after now, its time never below zero',
			state: running(-5_000),
			expected: { state: 'running', elapsedMs: 0, remainingMs: 60_000 },
		},
	])('reads $name as $expected.state', ({ state, expected }) => {
		expect(projectFeatureMatchClock(state, NOW, '')).toMatchObject(expected);
	});
});

// The one set of transitions the Session reducer and an operator's optimistic
// update both apply, each a pure function of a clock and a server instant.
describe('clockTransitions', () => {
	const NOW = 1_000_000;
	const base: FeatureMatchClock = {
		type: 'countdown',
		durationMs: 3_000_000,
		elapsedMs: 60_000,
		startedAt: null,
		countUpAfterCountdown: false,
		countUpLimitMs: null,
	};
	const stopped = base;
	const running: FeatureMatchClock = { ...base, startedAt: NOW - 5_000 };

	it.each<{ name: string; clock: FeatureMatchClock; transition: (clock: FeatureMatchClock) => FeatureMatchClock; changes: Partial<FeatureMatchClock> }>([
		{
			name: 'start runs a stopped clock from the instant',
			clock: stopped,
			transition: clock => clockTransitions.start(clock, NOW),
			changes: { startedAt: NOW },
		},
		{
			name: 'pause banks the time a running clock has run',
			clock: running,
			transition: clock => clockTransitions.pause(clock, NOW),
			changes: { startedAt: null, elapsedMs: 65_000 },
		},
		{
			name: 'reset stops a running clock with no time run, keeping its duration',
			clock: running,
			transition: clock => clockTransitions.reset(clock),
			changes: { startedAt: null, elapsedMs: 0 },
		},
		{
			name: 'reset to a duration takes it',
			clock: stopped,
			transition: clock => clockTransitions.reset(clock, 1_800_000),
			changes: { elapsedMs: 0, durationMs: 1_800_000 },
		},
		{
			name: 'restart runs a stopped clock from no time run',
			clock: stopped,
			transition: clock => clockTransitions.restart(clock, NOW),
			changes: { startedAt: NOW, elapsedMs: 0 },
		},
		{
			name: 'restart starts a running clock over from the instant',
			clock: running,
			transition: clock => clockTransitions.restart(clock, NOW),
			changes: { startedAt: NOW, elapsedMs: 0 },
		},
		{
			name: 'adjust moves a running countdown\'s end, banking the time run',
			clock: running,
			transition: clock => clockTransitions.adjust(clock, NOW, 30_000),
			changes: { startedAt: NOW, elapsedMs: 65_000, durationMs: 3_030_000 },
		},
		{
			name: 'set gives a countdown that much time remaining',
			clock: stopped,
			transition: clock => clockTransitions.set(clock, NOW, 200_000),
			changes: { durationMs: 260_000 },
		},
		{
			name: 'set gives a count-up clock that much time run',
			clock: { ...stopped, type: 'countup' },
			transition: clock => clockTransitions.set(clock, NOW, 200_000),
			changes: { elapsedMs: 200_000 },
		},
	])('$name', ({ clock, transition, changes }) => {
		expect(transition(clock)).toEqual({
			...clock,
			...changes,
		});
	});

	// A double press is harmless: the clock is handed back as it was.
	it.each<{ name: string; clock: FeatureMatchClock; transition: (clock: FeatureMatchClock) => FeatureMatchClock }>([
		{
			name: 'starting a running clock',
			clock: running,
			transition: clock => clockTransitions.start(clock, NOW),
		},
		{
			name: 'pausing a stopped clock',
			clock: stopped,
			transition: clock => clockTransitions.pause(clock, NOW),
		},
	])('$name changes nothing', ({ clock, transition }) => {
		expect(transition(clock)).toBe(clock);
	});
});

// Inside the app a clock is running from a server instant or stopped with an
// elapsed time. The stored Session state keeps its field set; this pair is the
// one place the two shapes meet.
describe('readStoredClock and writeStoredClock', () => {
	const stored: ClockState = {
		type: 'countdown',
		durationMs: 3_000_000,
		elapsedMs: 60_000,
		isRunning: false,
		lastStartedAt: null,
		countUpAfterCountdown: true,
		countUpLimitMs: 300_000,
	};
	const { countUpLimitMs: _limit, ...storedBeforeTheLimit } = stored;

	it.each<{ name: string; stored: ClockState; expected: Partial<FeatureMatchClock> }>([
		{
			name: 'a stopped clock as stopped at its elapsed time',
			stored,
			expected: {},
		},
		{
			name: 'a running clock as running from its start',
			stored: { ...stored, isRunning: true, lastStartedAt: 1_000_000 },
			expected: { startedAt: 1_000_000 },
		},
		{
			name: 'a clock running with no start as stopped at its stored elapsed time',
			stored: { ...stored, isRunning: true, lastStartedAt: null },
			expected: {},
		},
		{
			name: 'a stopped clock holding a start as stopped, the start ignored',
			stored: { ...stored, isRunning: false, lastStartedAt: 1_000_000 },
			expected: {},
		},
		{
			name: 'a clock stored before the count-up limit as counting up without limit',
			stored: storedBeforeTheLimit,
			expected: { countUpLimitMs: null },
		},
	])('reads $name', ({ stored, expected }) => {
		expect(readStoredClock(stored)).toStrictEqual({
			type: 'countdown',
			durationMs: 3_000_000,
			elapsedMs: 60_000,
			startedAt: null,
			countUpAfterCountdown: true,
			countUpLimitMs: 300_000,
			...expected,
		});
	});

	it.each<{ name: string; stored: ClockState; written: Partial<ClockState> }>([
		{
			name: 'a stopped clock with the fields it was stored with',
			stored,
			written: {},
		},
		{
			name: 'a running clock with the fields it was stored with',
			stored: { ...stored, isRunning: true, lastStartedAt: 1_000_000 },
			written: {},
		},
		{
			name: 'a clock running with no start as the stopped clock it read',
			stored: { ...stored, isRunning: true, lastStartedAt: null },
			written: { isRunning: false },
		},
		{
			name: 'a stopped clock holding a start with no start',
			stored: { ...stored, lastStartedAt: 1_000_000 },
			written: { lastStartedAt: null },
		},
	])('writes back $name', ({ stored, written }) => {
		expect(writeStoredClock(readStoredClock(stored))).toStrictEqual({
			...stored,
			...written,
		});
	});
});
