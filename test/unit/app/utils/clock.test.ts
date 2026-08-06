import { describe, expect, it } from 'vitest';
import { CLOCK_DECREMENT_OPTIONS, CLOCK_INCREMENT_OPTIONS } from '~~/app/utils/clock';

describe('cLOCK_DECREMENT_OPTIONS', () => {
	it('has 3 entries', () => {
		expect(CLOCK_DECREMENT_OPTIONS).toHaveLength(3);
	});

	it('each entry has label and deltaMs', () => {
		for (const option of CLOCK_DECREMENT_OPTIONS) {
			expect(option).toHaveProperty('label');
			expect(option).toHaveProperty('deltaMs');
			expect(typeof option.label).toBe('string');
			expect(typeof option.deltaMs).toBe('number');
		}
	});

	it('all deltaMs values are negative', () => {
		for (const option of CLOCK_DECREMENT_OPTIONS) {
			expect(option.deltaMs).toBeLessThan(0);
		}
	});

	it('is ordered from largest to smallest decrement', () => {
		const deltas = CLOCK_DECREMENT_OPTIONS.map((o: { deltaMs: number }) => o.deltaMs);
		expect(deltas[0]).toBeLessThan(deltas[1]!);
		expect(deltas[1]).toBeLessThan(deltas[2]!);
	});

	it('contains -5m, -1m, -10s with correct millisecond values', () => {
		expect(CLOCK_DECREMENT_OPTIONS[0]).toEqual({ label: '-5m', deltaMs: -300_000 });
		expect(CLOCK_DECREMENT_OPTIONS[1]).toEqual({ label: '-1m', deltaMs: -60_000 });
		expect(CLOCK_DECREMENT_OPTIONS[2]).toEqual({ label: '-10s', deltaMs: -10_000 });
	});
});

describe('cLOCK_INCREMENT_OPTIONS', () => {
	it('has 3 entries', () => {
		expect(CLOCK_INCREMENT_OPTIONS).toHaveLength(3);
	});

	it('each entry has label and deltaMs', () => {
		for (const option of CLOCK_INCREMENT_OPTIONS) {
			expect(option).toHaveProperty('label');
			expect(option).toHaveProperty('deltaMs');
			expect(typeof option.label).toBe('string');
			expect(typeof option.deltaMs).toBe('number');
		}
	});

	it('all deltaMs values are positive', () => {
		for (const option of CLOCK_INCREMENT_OPTIONS) {
			expect(option.deltaMs).toBeGreaterThan(0);
		}
	});

	it('is ordered from smallest to largest increment', () => {
		const deltas = CLOCK_INCREMENT_OPTIONS.map((o: { deltaMs: number }) => o.deltaMs);
		expect(deltas[0]).toBeLessThan(deltas[1]!);
		expect(deltas[1]).toBeLessThan(deltas[2]!);
	});

	it('contains +10s, +1m, +5m with correct millisecond values', () => {
		expect(CLOCK_INCREMENT_OPTIONS[0]).toEqual({ label: '+10s', deltaMs: 10_000 });
		expect(CLOCK_INCREMENT_OPTIONS[1]).toEqual({ label: '+1m', deltaMs: 60_000 });
		expect(CLOCK_INCREMENT_OPTIONS[2]).toEqual({ label: '+5m', deltaMs: 300_000 });
	});
});

describe('decrement and increment symmetry', () => {
	it('absolute deltaMs values mirror each other', () => {
		const decrements = CLOCK_DECREMENT_OPTIONS.map((o: { deltaMs: number }) => Math.abs(o.deltaMs)).sort((a: number, b: number) => a - b);
		const increments = CLOCK_INCREMENT_OPTIONS.map((o: { deltaMs: number }) => o.deltaMs).sort((a: number, b: number) => a - b);
		expect(decrements).toEqual(increments);
	});
});
