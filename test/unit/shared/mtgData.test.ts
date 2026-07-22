import { describe, expect, it } from 'vitest';
import { mtgCardDisplayModes, mtgColors, mtgColorsFromString, mtgColorsToString, mtgSets } from '~~/shared/utils/mtgData';

describe('mtgColorsToString', () => {
	it('joins color codes into a string', () => {
		expect(mtgColorsToString(['W', 'U', 'B'])).toBe('WUB');
	});

	it('returns empty string for empty array', () => {
		expect(mtgColorsToString([])).toBe('');
	});

	it('returns single color', () => {
		expect(mtgColorsToString(['R'])).toBe('R');
	});
});

describe('mtgColorsFromString', () => {
	it('splits string into individual color characters', () => {
		expect(mtgColorsFromString('WUB')).toEqual(['W', 'U', 'B']);
	});

	it('returns empty array for empty input', () => {
		expect(mtgColorsFromString('')).toEqual([]);
	});
});

describe('mtgColors', () => {
	it('contains all 6 colors (WUBRGC)', () => {
		expect(mtgColors).toHaveLength(6);
		const values = mtgColors.map(c => c.value);
		expect(values).toEqual(['W', 'U', 'B', 'R', 'G', 'C']);
	});
});

describe('mtgSets', () => {
	it('contains at least standard and modern formats', () => {
		const values = mtgSets.map(s => s.value);
		expect(values).toContain('standard');
		expect(values).toContain('modern');
	});
});

describe('mtgCardDisplayModes', () => {
	it('has preview mode with animation enabled', () => {
		expect(mtgCardDisplayModes.preview.animated).toBe(true);
	});

	it('has history mode with animation disabled', () => {
		expect(mtgCardDisplayModes.history.animated).toBe(false);
	});

	it('has list mode as selectable', () => {
		expect(mtgCardDisplayModes.list.selectable).toBe(true);
	});
});
