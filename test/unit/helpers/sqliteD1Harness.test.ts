import type { SqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * Drizzle's D1 driver reads `raw()` rows positionally. A libSQL row names only the first
 * column bearing a name, so a name-keyed rebuild silently collapses `a.id` and `b.id` on
 * every join; no consumer suite can see that.
 */

let harness: SqliteD1Harness;

beforeAll(async () => {
	harness = await createSqliteD1Harness();
	await harness.client.execute('CREATE TABLE left_table (id INTEGER, name TEXT)');
	await harness.client.execute('CREATE TABLE right_table (id INTEGER, name TEXT)');
	// Two rows on the left, so every assertion below is about a set of rows rather than
	// a single one: a `raw()` that answered only the first would otherwise satisfy both
	// tests. Ordered explicitly wherever they are read, so neither test rests on the
	// order a scan happens to return.
	await harness.client.execute(`INSERT INTO left_table VALUES (1, 'alpha')`);
	await harness.client.execute(`INSERT INTO left_table VALUES (2, 'bravo')`);
	await harness.client.execute(`INSERT INTO right_table VALUES (99, 'beta')`);
});

afterAll(async () => await harness.close());

describe('the libSQL D1 harness', () => {
	it('answers raw() by column position, so a join keeps both tables’ values apart', async () => {
		// Four columns, two distinct names. By name the first row reads
		// [1, 'alpha', 1, 'alpha']; D1 answers [1, 'alpha', 99, 'beta'], and so must this.
		// Two rows of it, so a `raw()` that answered only the first is caught here too.
		const rows = await harness.database.prepare(`
			SELECT left_table.id, left_table.name, right_table.id, right_table.name
			FROM left_table JOIN right_table
			ORDER BY left_table.id
		`).raw<unknown[]>();

		expect(rows).toEqual([
			[1, 'alpha', 99, 'beta'],
			[2, 'bravo', 99, 'beta'],
		]);
	});

	it('keeps every column of a wide row, including the ones holding null, zero and the empty string', async () => {
		// Repeated names catch a name-keyed rebuild, the distinct-name count a length from
		// `Object.keys`, the zero and empty string a `||` for `??`, and the second row a
		// single-array answer (#211).
		const rows = await harness.database.prepare(`
			SELECT id, NULL AS missing, 0 AS id, '' AS name, name FROM left_table
			ORDER BY left_table.id
		`).raw<unknown[]>();

		expect(rows).toEqual([
			[1, null, 0, '', 'alpha'],
			[2, null, 0, '', 'bravo'],
		]);
	});
});
