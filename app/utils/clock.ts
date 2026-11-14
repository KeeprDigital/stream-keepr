import type { FeatureMatchClockProjection, FeatureMatchClockState } from '~~/shared/utils/clock';
import { minutesToMs } from '~~/shared/utils/clock';

/** Decrement and increment options for clock adjustment buttons. */
export const CLOCK_DECREMENT_OPTIONS = [
	{ label: '-5m', deltaMs: -minutesToMs(5) },
	{ label: '-1m', deltaMs: -minutesToMs(1) },
	{ label: '-10s', deltaMs: -10 * 1000 },
] as const;

export const CLOCK_INCREMENT_OPTIONS = [
	{ label: '+10s', deltaMs: 10 * 1000 },
	{
		label: '+1m',
		deltaMs: minutesToMs(1),
	},
	{
		label: '+5m',
		deltaMs: minutesToMs(5),
	},
] as const;

const CLOCK_STATE_COLOR_CLASS: Record<Exclude<FeatureMatchClockState, 'untimed'>, string> = {
	'stopped': 'text-muted',
	'paused': 'text-warning',
	'running': 'text-primary',
	'run-out': 'text-error',
	'counting-up': 'text-error',
	'holding': 'text-error',
};

/**
 * How the control surface draws a Feature Match Session clock: its colour,
 * whether it pulses (run out and still running, with no count-up time to show),
 * and whether it is marked as showing count-up time. An Untimed Match's clock
 * has no state of its own to colour, so it takes the colour of whether it runs
 * or has run.
 */
export function clockAppearance({ state, isRunning, elapsedMs }: Pick<FeatureMatchClockProjection, 'state' | 'isRunning' | 'elapsedMs'>) {
	let untimedState: 'running' | 'paused' | 'stopped' = 'stopped';
	if (isRunning)
		untimedState = 'running';
	else if (elapsedMs > 0)
		untimedState = 'paused';

	return {
		colorClass: CLOCK_STATE_COLOR_CLASS[state === 'untimed'
			? untimedState
			: state],
		pulses: state === 'run-out' && isRunning,
		showsCountUp: state === 'counting-up' || state === 'holding',
	};
}
