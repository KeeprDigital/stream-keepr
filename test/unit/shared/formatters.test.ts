import { describe, expect, it } from 'vitest';
import { formatOrdinal, getOrdinalSuffix } from '~~/shared/utils/formatters';

describe('ordinals', () => {
	it.each([
		[1, '1st'],
		[2, '2nd'],
		[3, '3rd'],
		[4, '4th'],
		[10, '10th'],
		[11, '11th'],
		[12, '12th'],
		[13, '13th'],
		[21, '21st'],
		[22, '22nd'],
		[23, '23rd'],
		[101, '101st'],
		[111, '111th'],
		[112, '112th'],
	])('formats %i as %s', (n, expected) => {
		expect(formatOrdinal(n)).toBe(expected);
		expect(`${n}${getOrdinalSuffix(n)}`).toBe(expected);
	});
});
