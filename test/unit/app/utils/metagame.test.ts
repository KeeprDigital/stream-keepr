import { describe, expect, it } from 'vitest';
import { formatPercent, maxMetaShare } from '~~/app/utils/metagame';

describe('formatPercent', () => {
	it('formats 0 as "0%"', () => {
		expect(formatPercent(0)).toBe('0%');
	});

	it('formats 50 as "50%"', () => {
		expect(formatPercent(50)).toBe('50%');
	});

	it('formats 100 as "100%"', () => {
		expect(formatPercent(100)).toBe('100%');
	});

	it('formats decimal values', () => {
		expect(formatPercent(12.5)).toBe('12.5%');
		expect(formatPercent(33.33)).toBe('33.33%');
	});

	it('returns "-" for null', () => {
		expect(formatPercent(null)).toBe('-');
	});

	it('returns "-" for undefined (coerced via ==)', () => {
		expect(formatPercent(undefined as unknown as null)).toBe('-');
	});
});

describe('maxMetaShare', () => {
	it('returns the maximum metaShare from entries', () => {
		const entries = [
			{ metaShare: 10 },
			{ metaShare: 25 },
			{ metaShare: 15 },
		];
		expect(maxMetaShare(entries)).toBe(25);
	});

	it('returns 1 for an empty array (avoids division by zero)', () => {
		expect(maxMetaShare([])).toBe(1);
	});

	it('returns the value when only one entry exists', () => {
		expect(maxMetaShare([{ metaShare: 42 }])).toBe(42);
	});

	it('returns 1 when all metaShare values are 0', () => {
		const entries = [{ metaShare: 0 }, { metaShare: 0 }];
		expect(maxMetaShare(entries)).toBe(1);
	});

	it('handles decimal metaShare values', () => {
		const entries = [
			{ metaShare: 12.5 },
			{ metaShare: 33.3 },
			{ metaShare: 8.1 },
		];
		expect(maxMetaShare(entries)).toBe(33.3);
	});

	it('handles entries with extra properties', () => {
		const entries = [
			{ metaShare: 5, name: 'Deck A' },
			{ metaShare: 20, name: 'Deck B' },
		];
		expect(maxMetaShare(entries as { metaShare: number }[])).toBe(20);
	});
});
