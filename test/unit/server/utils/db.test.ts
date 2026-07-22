import { describe, expect, it } from 'vitest';
import {
	chunkArray,
	chunkJsonRows,
	D1_JSON_BULK_MAX_BYTES,
	D1_JSON_BULK_MAX_ROWS,
	D1_MAX_PARAMS,
	maxInsertChunkSize,
	SAFE_INARRAY_SIZE,
} from '~~/server/utils/db';

describe('d1 constants', () => {
	it('d1_MAX_PARAMS is 100', () => {
		expect(D1_MAX_PARAMS).toBe(100);
	});

	it('sAFE_INARRAY_SIZE is 50', () => {
		expect(SAFE_INARRAY_SIZE).toBe(50);
	});
});

describe('chunkArray', () => {
	it('empty array returns empty array', () => {
		expect(chunkArray([], 10)).toEqual([]);
	});

	it('array smaller than chunk size returns one chunk', () => {
		expect(chunkArray([1, 2, 3], 10)).toEqual([[1, 2, 3]]);
	});

	it('array exactly equal to chunk size returns one chunk', () => {
		expect(chunkArray([1, 2, 3], 3)).toEqual([[1, 2, 3]]);
	});

	it('array with exact multiple of chunk size returns correct chunks', () => {
		expect(chunkArray([1, 2, 3, 4, 5, 6], 2)).toEqual([[1, 2], [3, 4], [5, 6]]);
	});

	it('array with remainder produces correct last chunk', () => {
		const result = chunkArray([1, 2, 3, 4, 5], 2);
		expect(result).toEqual([[1, 2], [3, 4], [5]]);
	});

	it('chunk size of 1 puts each element in its own chunk', () => {
		expect(chunkArray([1, 2, 3], 1)).toEqual([[1], [2], [3]]);
	});

	it('preserves element types (strings)', () => {
		expect(chunkArray(['a', 'b', 'c'], 2)).toEqual([['a', 'b'], ['c']]);
	});

	it('all chunk values concatenated equal the original array', () => {
		const arr = Array.from({ length: 55 }, (_, i) => i);
		const chunks = chunkArray(arr, 16);
		expect(chunks.flat()).toEqual(arr);
	});
});

describe('maxInsertChunkSize', () => {
	it('5 columns → 20 rows (playerDeckCards)', () => {
		expect(maxInsertChunkSize(5)).toBe(20);
	});

	it('10 columns → 10 rows', () => {
		expect(maxInsertChunkSize(10)).toBe(10);
	});

	it('1 column → 100 rows', () => {
		expect(maxInsertChunkSize(1)).toBe(100);
	});

	it('result * colCount never exceeds D1_MAX_PARAMS', () => {
		for (let cols = 1; cols <= 20; cols++) {
			expect(maxInsertChunkSize(cols) * cols).toBeLessThanOrEqual(D1_MAX_PARAMS);
		}
	});
});

describe('chunkJsonRows', () => {
	it('keeps one thousand small rows in one bounded payload', () => {
		const chunks = chunkJsonRows(Array.from({ length: 1000 }, (_, id) => ({ id })));

		expect(chunks).toHaveLength(1);
		expect(JSON.parse(chunks[0]!)).toHaveLength(D1_JSON_BULK_MAX_ROWS);
		expect(new TextEncoder().encode(chunks[0]).byteLength).toBeLessThanOrEqual(D1_JSON_BULK_MAX_BYTES);
	});

	it('chunks by serialized UTF-8 byte size without splitting a row', () => {
		const chunks = chunkJsonRows([{ value: 'é'.repeat(10) }, { value: 'é'.repeat(10) }], {
			maxRows: 100,
			maxBytes: 40,
		});

		expect(chunks).toHaveLength(2);
		expect(chunks.flatMap(chunk => JSON.parse(chunk))).toHaveLength(2);
	});

	it('rejects a single row larger than the configured payload ceiling', () => {
		expect(() => chunkJsonRows([{ value: 'x'.repeat(100) }], { maxBytes: 20 }))
			.toThrow('one row exceeds');
	});
});
