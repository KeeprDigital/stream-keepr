import { describe, expect, it } from 'vitest';
import { formatPercent, maxMetaShare } from '~~/app/utils/metagame';

describe('formatPercent', () => {
	it.each([
		[0, '0%'],
		[100, '100%'],
		[33.33, '33.33%'],
		[null, '-'],
		[undefined, '-'],
	])('formats %s as %s', (value, formatted) => {
		expect(formatPercent(value as number | null)).toBe(formatted);
	});
});

describe('maxMetaShare', () => {
	it('returns the largest metaShare', () => {
		expect(maxMetaShare([
			{ metaShare: 10 },
			{ metaShare: 33.3 },
			{ metaShare: 15 },
		])).toBe(33.3);
	});

	it.each([
		['no entries', []],
		[
			'all-zero shares',
			[
				{ metaShare: 0 },
				{ metaShare: 0 },
			],
		],
	])('returns 1 for %s, so it is always safe to divide by', (_, entries) => {
		expect(maxMetaShare(entries)).toBe(1);
	});
});
