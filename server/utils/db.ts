/**
 * D1 / SQLite safety constants and helpers.
 *
 * D1 enforces a hard limit of 100 bound parameters per SQL statement.
 * Every INSERT, UPDATE, or WHERE IN clause must stay under this limit.
 * All DB-touching code should import from here rather than hard-coding values.
 *
 * Reference: https://developers.cloudflare.com/d1/platform/limits/
 */

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
