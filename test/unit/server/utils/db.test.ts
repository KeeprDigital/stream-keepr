import { describe, expect, it } from 'vitest';
import {
	chunkArray,
	chunkJsonRows,
	chunkRowsWithinParameterBudget,
	D1_JSON_BULK_MAX_BYTES,
	D1_JSON_BULK_MAX_ROWS,
	D1_MAX_PARAMS,
	maxInsertChunkSize,
} from '~~/server/utils/db';

describe('chunkArray', () => {
	it.each([
		[[], 10, []],
		[
			[1, 2, 3],
			3,
			[
				[1, 2, 3],
			],
		],
		[
			[1, 2, 3, 4, 5],
			2,
			[
				[1, 2],
				[3, 4],
				[5],
			],
		],
	])('splits %j into chunks of %i', (items, size, chunks) => {
		expect(chunkArray(items, size)).toEqual(chunks);
	});
});

describe('maxInsertChunkSize', () => {
	it('fits as many rows as D1\'s parameter limit allows for a column count', () => {
		for (let columns = 1; columns <= 20; columns++) {
			const rows = maxInsertChunkSize(columns);
			expect(rows * columns).toBeLessThanOrEqual(D1_MAX_PARAMS);
			expect((rows + 1) * columns).toBeGreaterThan(D1_MAX_PARAMS);
		}
	});
});

describe('chunkRowsWithinParameterBudget', () => {
	/** A statement binding each row's own parameters, as a multi-row insert does. */
	const statementFor = (rows: { params: number }[]) => ({
		toSQL: () => ({
			params: rows.flatMap(row => Array.from({ length: row.params }).fill(0)),
		}),
	});
	const rowsOf = (count: number, params: number) => Array.from({ length: count }, () => ({ params }));

	it('answers no groups for no rows', () => {
		expect(chunkRowsWithinParameterBudget([], statementFor)).toEqual([]);
	});

	it('fits fifty four-parameter rows in two groups of twenty-five', () => {
		const groups = chunkRowsWithinParameterBudget(rowsOf(50, 4), statementFor);

		expect(groups.map(group => group.length)).toEqual([25, 25]);
	});

	it('keeps rows that fit in one statement together', () => {
		expect(chunkRowsWithinParameterBudget(rowsOf(25, 4), statementFor)).toHaveLength(1);
	});

	it('refuses a row that alone binds more than D1 accepts', () => {
		expect(() => chunkRowsWithinParameterBudget(rowsOf(1, D1_MAX_PARAMS + 1), statementFor)).toThrow(/one row binds 101/);
	});

	it('refuses a group whose later rows bind more than the first did', () => {
		const rows = [
			{ params: 1 },
			...rowsOf(20, 10),
		];

		expect(() => chunkRowsWithinParameterBudget(rows, statementFor)).toThrow(/a group binds/);
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
		const chunks = chunkJsonRows([
			{
				value: 'é'.repeat(10),
			},
			{
				value: 'é'.repeat(10),
			},
		], {
			maxRows: 100,
			maxBytes: 40,
		});

		expect(chunks).toHaveLength(2);
		expect(chunks.flatMap(chunk => JSON.parse(chunk))).toHaveLength(2);
	});

	it('rejects a single row larger than the configured payload ceiling', () => {
		expect(() => chunkJsonRows([
			{
				value: 'x'.repeat(100),
			},
		], { maxBytes: 20 }))
			.toThrow('one row exceeds');
	});
});
