import { describe, expect, it } from 'vitest';
import { clockAppearance } from '~~/app/utils/clock';

describe('clockAppearance', () => {
	// The colours an operator reads a clock by. Only a clock run out and still
	// running pulses; one showing overtime is marked instead, running or not.
	it.each([
		['untimed', false, { colorClass: 'text-muted', pulses: false, showsOvertime: false }],
		['stopped', false, { colorClass: 'text-muted', pulses: false, showsOvertime: false }],
		['paused', false, { colorClass: 'text-warning', pulses: false, showsOvertime: false }],
		['running', true, { colorClass: 'text-primary', pulses: false, showsOvertime: false }],
		['run-out', false, { colorClass: 'text-error', pulses: false, showsOvertime: false }],
		['run-out', true, { colorClass: 'text-error', pulses: true, showsOvertime: false }],
		['counting-up', true, { colorClass: 'text-error', pulses: false, showsOvertime: true }],
		['holding', true, { colorClass: 'text-error', pulses: false, showsOvertime: true }],
	] as const)('draws a %s clock, running %s, as %j', (state, isRunning, expected) => {
		expect(clockAppearance(state, isRunning)).toEqual(expected);
	});
});
