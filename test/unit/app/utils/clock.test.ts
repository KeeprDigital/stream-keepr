import type { FeatureMatchClockState } from '~~/shared/utils/clock';
import { describe, expect, it } from 'vitest';
import { clockAppearance } from '~~/app/utils/clock';

describe('clockAppearance', () => {
	// The colours an operator reads a clock by. Only a clock run out and still
	// running pulses; one showing count-up time is marked instead, running or not.
	// An Untimed Match's clock takes the colour of whether it runs or has run.
	it.each<[FeatureMatchClockState, boolean, number, ReturnType<typeof clockAppearance>]>([
		[
			'untimed',
			false,
			0,
			{ colorClass: 'text-muted', pulses: false, showsCountUp: false },
		],
		[
			'untimed',
			false,
			1000,
			{ colorClass: 'text-warning', pulses: false, showsCountUp: false },
		],
		[
			'untimed',
			true,
			1000,
			{ colorClass: 'text-primary', pulses: false, showsCountUp: false },
		],
		[
			'stopped',
			false,
			0,
			{ colorClass: 'text-muted', pulses: false, showsCountUp: false },
		],
		[
			'paused',
			false,
			1000,
			{ colorClass: 'text-warning', pulses: false, showsCountUp: false },
		],
		[
			'running',
			true,
			1000,
			{ colorClass: 'text-primary', pulses: false, showsCountUp: false },
		],
		[
			'run-out',
			false,
			5000,
			{ colorClass: 'text-error', pulses: false, showsCountUp: false },
		],
		[
			'run-out',
			true,
			5000,
			{ colorClass: 'text-error', pulses: true, showsCountUp: false },
		],
		[
			'counting-up',
			true,
			5000,
			{ colorClass: 'text-error', pulses: false, showsCountUp: true },
		],
		[
			'holding',
			false,
			5000,
			{ colorClass: 'text-error', pulses: false, showsCountUp: true },
		],
	])('draws a %s clock, running %s with %i ms run, as %j', (state, isRunning, elapsedMs, expected) => {
		expect(clockAppearance({ state, isRunning, elapsedMs })).toEqual(expected);
	});
});
