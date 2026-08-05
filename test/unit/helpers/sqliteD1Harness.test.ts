import type { SqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * The one contract of the libSQL harness that no consumer can check for itself.
 *
 * `raw()` is not a convenience: Drizzle's D1 driver routes every `select()` and
 * `.returning()` that names fields through `values()` → `stmt.raw()`, and reads the
 * result **positionally**. Six suites and counting build their fixtures through that
 * path, so a `raw()` that answers in any other order does not fail — it hands each
 * consumer a plausible row with the wrong values in it.
 *
 * The specific trap, and the reason this is pinned rather than left to review: a
 * libSQL row exposes a numeric index for every column but registers a *name* only
 * for the first column bearing it. Rebuilding rows by column name therefore looks
 * exactly right, passes every single-table test, and silently collapses `a.id` and
 * `b.id` to the left table's value on every join. In this schema that is most joins,
 * because `id`, `created_at` and `updated_at` are near-universal.
 *
 * It is worth stating what the earlier failure mode was, because it was the better
 * one: rebuilding with `[...row]` threw `row is not iterable` outright. Trading a
 * loud failure for a quiet wrong answer is the direction this repository has been
 * bitten by most, and this test exists so the trade cannot be made again by accident.
 */

let harness: SqliteD1Harness;

beforeAll(async () => {
	harness = await createSqliteD1Harness();
	await harness.client.execute('CREATE TABLE left_table (id INTEGER, name TEXT)');
	await harness.client.execute('CREATE TABLE right_table (id INTEGER, name TEXT)');
	await harness.client.execute(`INSERT INTO left_table VALUES (1, 'alpha')`);
	await harness.client.execute(`INSERT INTO right_table VALUES (99, 'beta')`);
});

afterAll(async () => await harness.close());

describe('the libSQL D1 harness', () => {
	it('answers raw() by column position, so a join keeps both tables’ values apart', async () => {
		// Four columns, two distinct names. By name this reads [1, 'alpha', 1, 'alpha'];
		// D1 answers [1, 'alpha', 99, 'beta'], and so must this.
		const rows = await harness.database.prepare(`
			SELECT left_table.id, left_table.name, right_table.id, right_table.name
			FROM left_table JOIN right_table
		`).raw<unknown[]>();

		expect(rows).toEqual([[1, 'alpha', 99, 'beta']]);
	});

	it('keeps every column of a wide row, including the ones holding null', async () => {
		// `?? null` is how an absent value is normalised, and reading positionally is
		// what stops that normalisation from also shortening the row: a name-keyed
		// rebuild drops nothing visible here, but a length taken from the row rather
		// than from `columns` would.
		const rows = await harness.database.prepare(
			'SELECT id, NULL AS missing, name FROM left_table',
		).raw<unknown[]>();

		expect(rows).toEqual([[1, null, 'alpha']]);
	});
});
