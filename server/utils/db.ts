/**
 * D1 / SQLite safety constants and helpers.
 *
 * D1 enforces a hard limit of 100 bound parameters per SQL statement.
 * Every INSERT, UPDATE, or WHERE IN clause must stay under this limit.
 * All DB-touching code should import from here rather than hard-coding values.
 *
 * Reference: https://developers.cloudflare.com/d1/platform/limits/
 */

import type { SQL } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { getTableColumns, sql } from 'drizzle-orm';

export const D1_MAX_PARAMS = 100;

/**
 * Safe upper bound for `inArray()` calls.
 * Conservative — leaves headroom for other parameters in the same query.
 */
export const SAFE_INARRAY_SIZE = 50;

/**
 * Conservative application-level limits for JSON-bound bulk statements.
 *
 * A JSON array is bound as one SQLite parameter and expanded with
 * `json_each(?)`. Keeping both a row and serialized-byte ceiling prevents one
 * very large payload from becoming one unbounded D1 statement while retaining
 * a near-constant statement count for normal snapshots.
 */
export const D1_JSON_BULK_MAX_ROWS = 1000;
export const D1_JSON_BULK_MAX_BYTES = 512 * 1024;

/**
 * Split an array into chunks of at most `size` elements.
 *
 * @example
 * chunkArray([1,2,3,4,5], 2) // [[1,2],[3,4],[5]]
 */
export function chunkArray<T>(arr: T[], size: number): T[][] {
	if (size <= 0)
		throw new Error('chunkArray: size must be a positive integer');

	const chunks: T[][] = [];
	for (let i = 0; i < arr.length; i += size) {
		chunks.push(arr.slice(i, i + size));
	}
	return chunks;
}

/**
 * Maximum number of rows that can be inserted in a single multi-row
 * `INSERT … VALUES (…),(…),…` statement without exceeding D1's 100-parameter limit.
 *
 * @param colCount Number of bound columns per row (exclude auto-increment `id`).
 *
 * @example
 * // playerDeckCards has 5 bound columns → 20 rows max
 * maxInsertChunkSize(5) // 20
 */
export function maxInsertChunkSize(colCount: number): number {
	if (colCount <= 0)
		throw new Error('maxInsertChunkSize: colCount must be a positive integer');

	return Math.floor(D1_MAX_PARAMS / colCount);
}

/**
 * One select expression per insertable column of the target table.
 * Generated-always columns are excluded, mirroring the runtime filter below.
 */
export type InsertSelectColumns<TTable extends SQLiteTable> = {
	[K in keyof TTable['_']['columns'] as TTable['_']['columns'][K]['_']['generated'] extends { type: 'always' } ? never : K]: SQL;
};

/**
 * The `select …` half of an `INSERT INTO … SELECT`, with every expression named
 * by the column it feeds.
 *
 * Drizzle's `.insert(table).select(sql)` emits its column list from the table's
 * declared column order and trusts the raw select to match it positionally — a
 * same-affinity column swap in the schema would corrupt data without an error
 * (#467). This helper takes the expressions keyed by column instead, checks the
 * map covers the insertable columns exactly, and emits them in the order
 * drizzle's column list uses, so no call site depends on declaration order.
 *
 * `tail` is everything after the select list: `from json_each(…)`, guard
 * `where` clauses, or both.
 *
 * @example
 * db.insert(playerListMembers).select(selectForInsert(playerListMembers, {
 * 	id: sql`null`,
 * 	listId: sql`${listId}`,
 * 	playerId: sql`json_extract(value, '$.playerId')`,
 * 	sortOrder: sql`json_extract(value, '$.sortOrder')`,
 * 	createdAt: sql`${nowMs}`,
 * 	updatedAt: sql`${nowMs}`,
 * }, sql`from json_each(${payload}) where true`))
 */
export function selectForInsert<TTable extends SQLiteTable>(
	table: TTable,
	columns: InsertSelectColumns<TTable>,
	tail: SQL,
): SQL {
	// Mirrors drizzle's own insert-order filter: generated-always columns are
	// excluded from the column list it emits.
	const allColumns = getTableColumns(table);
	const insertable = Object.entries(allColumns)
		.filter(([, column]) => column.generated === undefined || column.generated.type === 'byDefault');
	const provided = new Set(Object.keys(columns));
	const expected = new Set(insertable.map(([key]) => key));

	const missing = [...expected].filter(key => !provided.has(key));
	if (missing.length > 0)
		throw new Error(`selectForInsert: missing expressions for columns: ${missing.join(', ')}`);
	const unknown = [...provided].filter(key => !expected.has(key));
	if (unknown.length > 0) {
		const labelled = unknown.map(key => key in allColumns ? `${key} (generated — not insertable)` : key);
		throw new Error(`selectForInsert: unknown or non-insertable columns: ${labelled.join(', ')}`);
	}

	const expressions = insertable.map(([key]) => (columns as Record<string, SQL>)[key]!);
	return sql`select ${sql.join(expressions, sql`, `)} ${tail}`;
}

export interface JsonBulkChunkOptions {
	maxRows?: number;
	maxBytes?: number;
}

/**
 * Serialize rows into bounded JSON arrays suitable for `json_each(?)`.
 * The returned strings include the surrounding array brackets.
 */
export function chunkJsonRows<T>(
	rows: readonly T[],
	options: JsonBulkChunkOptions = {},
): string[] {
	const maxRows = options.maxRows ?? D1_JSON_BULK_MAX_ROWS;
	const maxBytes = options.maxBytes ?? D1_JSON_BULK_MAX_BYTES;
	if (!Number.isInteger(maxRows) || maxRows <= 0)
		throw new Error('chunkJsonRows: maxRows must be a positive integer');
	if (!Number.isInteger(maxBytes) || maxBytes <= 2)
		throw new Error('chunkJsonRows: maxBytes must be an integer greater than two');

	const encoder = new TextEncoder();
	const chunks: string[] = [];
	let entries: string[] = [];
	let byteLength = 2; // `[]`

	for (const row of rows) {
		const serialized = JSON.stringify(row);
		if (serialized === undefined)
			throw new Error('chunkJsonRows: a row could not be serialized');

		const serializedBytes = encoder.encode(serialized).byteLength;
		if (serializedBytes + 2 > maxBytes)
			throw new Error(`chunkJsonRows: one row exceeds the ${maxBytes}-byte payload limit`);

		const nextBytes = byteLength + serializedBytes + (entries.length > 0 ? 1 : 0);
		if (entries.length > 0 && (entries.length >= maxRows || nextBytes > maxBytes)) {
			chunks.push(`[${entries.join(',')}]`);
			entries = [];
			byteLength = 2;
		}

		entries.push(serialized);
		byteLength += serializedBytes + (entries.length > 1 ? 1 : 0);
	}

	if (entries.length > 0)
		chunks.push(`[${entries.join(',')}]`);

	return chunks;
}
