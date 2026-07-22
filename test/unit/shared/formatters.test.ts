import { describe, expect, it } from 'vitest';
import { formatOrdinal, getOrdinalSuffix } from '~~/shared/utils/formatters';

describe('getOrdinalSuffix', () => {
	it('returns "st" for 1', () => {
		expect(getOrdinalSuffix(1)).toBe('st');
	});

	it('returns "nd" for 2', () => {
		expect(getOrdinalSuffix(2)).toBe('nd');
	});

	it('returns "rd" for 3', () => {
		expect(getOrdinalSuffix(3)).toBe('rd');
	});

	it('returns "th" for 4-10', () => {
		for (const n of [4, 5, 6, 7, 8, 9, 10]) {
			expect(getOrdinalSuffix(n)).toBe('th');
		}
	});

	it('returns "th" for teens (11, 12, 13)', () => {
		expect(getOrdinalSuffix(11)).toBe('th');
		expect(getOrdinalSuffix(12)).toBe('th');
		expect(getOrdinalSuffix(13)).toBe('th');
	});

	it('returns "st" for 21, "nd" for 22, "rd" for 23', () => {
		expect(getOrdinalSuffix(21)).toBe('st');
		expect(getOrdinalSuffix(22)).toBe('nd');
		expect(getOrdinalSuffix(23)).toBe('rd');
	});

	it('handles 100+', () => {
		expect(getOrdinalSuffix(101)).toBe('st');
		expect(getOrdinalSuffix(111)).toBe('th');
		expect(getOrdinalSuffix(112)).toBe('th');
	});
});

describe('formatOrdinal', () => {
	it('formats 1 as "1st"', () => {
		expect(formatOrdinal(1)).toBe('1st');
	});

	it('formats 2 as "2nd"', () => {
		expect(formatOrdinal(2)).toBe('2nd');
	});

	it('formats 11 as "11th"', () => {
		expect(formatOrdinal(11)).toBe('11th');
	});

	it('formats 23 as "23rd"', () => {
		expect(formatOrdinal(23)).toBe('23rd');
	});
});
