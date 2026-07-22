/** Decrement and increment options for clock adjustment buttons. */
export const CLOCK_DECREMENT_OPTIONS = [
	{ label: '-5m', deltaMs: -5 * 60 * 1000 },
	{ label: '-1m', deltaMs: -60 * 1000 },
	{ label: '-10s', deltaMs: -10 * 1000 },
] as const;

export const CLOCK_INCREMENT_OPTIONS = [
	{ label: '+10s', deltaMs: 10 * 1000 },
	{ label: '+1m', deltaMs: 60 * 1000 },
	{ label: '+5m', deltaMs: 5 * 60 * 1000 },
] as const;
