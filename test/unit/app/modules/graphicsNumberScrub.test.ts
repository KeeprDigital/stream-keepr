import { describe, expect, it } from 'vitest';
import { scrubNumber, startNumberScrub } from '~~/app/modules/graphics/numberScrub';

/**
 * Dragging a number field's label: one displayed step per 2px, Shift ×10, Alt ×0.1,
 * held inside the field's bounds.
 */

const NONE = { shiftKey: false, altKey: false };
const SHIFT = { shiftKey: true, altKey: false };
const ALT = { shiftKey: false, altKey: true };

describe('number scrub', () => {
	it.each([
		{
			case: 'one step per 2px right',
			start: 10,
			dx: 6,
			step: 1,
			keys: NONE,
			bounds: {},
			value: 13,
		},
		{
			case: 'one step per 2px left',
			start: 10,
			dx: -6,
			step: 1,
			keys: NONE,
			bounds: {},
			value: 7,
		},
		{
			case: 'under 2px moves nothing',
			start: 10,
			dx: 1.9,
			step: 1,
			keys: NONE,
			bounds: {},
			value: 10,
		},
		{
			case: 'Shift moves ten steps',
			start: 10,
			dx: 4,
			step: 1,
			keys: SHIFT,
			bounds: {},
			value: 30,
		},
		{
			case: 'Alt moves a tenth of a step',
			start: 10,
			dx: 4,
			step: 1,
			keys: ALT,
			bounds: {},
			value: 10.2,
		},
		{
			case: 'the field\'s own step',
			start: 0.5,
			dx: 6,
			step: 0.05,
			keys: NONE,
			bounds: {},
			value: 0.65,
		},
		{
			case: 'a fine step on a fine field',
			start: 0.5,
			dx: 6,
			step: 0.05,
			keys: ALT,
			bounds: {},
			value: 0.515,
		},
		{
			case: 'relative to an off-step start',
			start: 13.37,
			dx: 2,
			step: 1,
			keys: NONE,
			bounds: {},
			value: 14.37,
		},
		{
			case: 'held at the maximum',
			start: 0.9,
			dx: 40,
			step: 0.05,
			keys: NONE,
			bounds: { min: 0, max: 1 },
			value: 1,
		},
		{
			case: 'held at the minimum',
			start: 5,
			dx: -40,
			step: 1,
			keys: NONE,
			bounds: { min: 0 },
			value: 0,
		},
		{
			case: 'a start outside the bounds comes inside',
			start: 400,
			dx: 2,
			step: 1,
			keys: NONE,
			bounds: { min: -360, max: 360 },
			value: 360,
		},
	])('$case', ({ start, dx, step, keys, bounds, value }) => {
		const scrub = scrubNumber(startNumberScrub(start, bounds), {
			dx,
			step,
			...keys,
			...bounds,
		});
		expect(scrub.value).toBe(value);
	});

	it('keeps the pixels short of a step for the next move', () => {
		const once = scrubNumber(startNumberScrub(10), { dx: 1, step: 1, ...NONE });
		const twice = scrubNumber(once, { dx: 1, step: 1, ...NONE });
		expect([once.value, twice.value]).toEqual([10, 11]);
	});

	it('turns back from a bound at once, rather than unwinding the overshoot', () => {
		const pinned = scrubNumber(startNumberScrub(9), { dx: 20, step: 1, max: 10, ...NONE });
		const back = scrubNumber(pinned, { dx: -2, step: 1, max: 10, ...NONE });
		expect([pinned.value, back.value]).toEqual([10, 9]);
	});

	it('changes rate mid-drag without jumping', () => {
		const coarse = scrubNumber(startNumberScrub(0), { dx: 2, step: 1, ...SHIFT });
		const fine = scrubNumber(coarse, { dx: 2, step: 1, ...ALT });
		expect([coarse.value, fine.value]).toEqual([10, 10.1]);
	});
});
