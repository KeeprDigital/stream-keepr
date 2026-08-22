import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * #467: no `INSERT … SELECT` may trust column position. A raw select passed to
 * drizzle's `.insert(table).select(sql`…`)` is matched to the table's declared
 * column order with no name anywhere in the statement, so a same-affinity
 * column reorder in the schema corrupts data without an error — a count change
 * fails loudly, a swap does not. `selectForInsert` (server/utils/db.ts) is the
 * sanctioned path: it names every expression by column and derives the order
 * itself.
 *
 * A source scan rather than a runtime check because the defect is invisible at
 * runtime by construction — the corrupted write succeeds.
 */

const serverDirectory = fileURLToPath(new URL('../../../server', import.meta.url));

/** `.select(sql` — a raw, positional select handed to an insert builder. */
const POSITIONAL_INSERT_SELECT = /\.select\(\s*sql`/;

/**
 * `INSERT INTO <name> SELECT|VALUES` with no `(column, …)` list between —
 * whether the table is a literal name or a `${table}` interpolation.
 */
const RAW_INSERT_WITHOUT_COLUMNS = /insert\s+into\s+(?:[`"']?\w+[`"']?|\$\{[^}]+\})\s+(?:select|values)\b/i;

function sourceFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory())
			return sourceFiles(path);
		return entry.name.endsWith('.ts') ? [path] : [];
	});
}

describe('insert-select statements in server code', () => {
	const files = sourceFiles(serverDirectory);

	it('has sources to scan at all', () => {
		expect(files.length).toBeGreaterThan(0);
	});

	it('never hands a raw positional select to an insert builder', () => {
		const offenders = files.filter(path => POSITIONAL_INSERT_SELECT.test(readFileSync(path, 'utf8')));
		expect(offenders, 'use selectForInsert from server/utils/db.ts instead of .select(sql`…`)').toEqual([]);
	});

	it('gives every raw INSERT statement an explicit column list', () => {
		const offenders = files.filter(path => RAW_INSERT_WITHOUT_COLUMNS.test(readFileSync(path, 'utf8')));
		expect(offenders, 'raw INSERT INTO must name its columns before SELECT/VALUES').toEqual([]);
	});
});
