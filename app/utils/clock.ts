import type { FeatureMatchClockState } from '~~/shared/utils/clock';
import { minutesToMs } from '~~/shared/utils/clock';

/** Decrement and increment options for clock adjustment buttons. */
export const CLOCK_DECREMENT_OPTIONS = [
	{ label: '-5m', deltaMs: -minutesToMs(5) },
	{ label: '-1m', deltaMs: -minutesToMs(1) },
	{ label: '-10s', deltaMs: -10 * 1000 },
] as const;

export const CLOCK_INCREMENT_OPTIONS = [
	{ label: '+10s', deltaMs: 10 * 1000 },
	{ label: '+1m', deltaMs: minutesToMs(1) },
	{ label: '+5m', deltaMs: minutesToMs(5) },
] as const;

const CLOCK_STATE_COLOR_CLASS: Record<FeatureMatchClockState, string> = {
	'untimed': 'text-muted',
	'stopped': 'text-muted',
	'paused': 'text-warning',
	'running': 'text-primary',
	'run-out': 'text-error',
	'counting-up': 'text-error',
	'holding': 'text-error',
};

/**
 * How the control surface draws a Feature Match Session clock in each state:
 * its colour, whether it pulses (run out and still running, with no overtime to
 * show), and whether it is marked as showing overtime.
 */
export function clockAppearance(state: FeatureMatchClockState, isRunning: boolean) {
	return {
		colorClass: CLOCK_STATE_COLOR_CLASS[state],
		pulses: state === 'run-out' && isRunning,
		showsOvertime: state === 'counting-up' || state === 'holding',
	};
}
