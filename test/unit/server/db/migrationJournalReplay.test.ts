/**
 * The migration journal replayed against a database that already holds rows.
 *
 * Every migration in this repository has only ever been applied to the one
 * production database, in order, as it was written — so a migration that is
 * illegal against a populated table still applies cleanly there, because the
 * table was empty at the moment it ran. The replay this suite performs is the
 * case nothing else covers: a backup restore, or a new environment seeded from
 * one, where the journal meets tables that already have rows.
 *
 * SQLite rejects `ALTER TABLE ... ADD COLUMN ... NOT NULL` without a non-null
 * `DEFAULT` only when the table is non-empty ("Cannot add a NOT NULL column
 * with default value NULL"), which is exactly why the defect is invisible to
 * every other suite. #310.
 */

import { describe, expect, it } from 'vitest';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * Held back at 0001 because that is the last migration before either affected
 * table gains its column, and the first at which both tables exist.
 */
async function replayFromPopulated() {
	const harness = await createSqliteD1Harness({ throughMigration: '0001' });
	await harness.client.execute(
		`INSERT INTO events (id, name, game, feature_match_orientation)
		 VALUES (1, 'Replay Open', 'mtg', 'horizontal')`,
	);
	// Two of each: one row proves the NOT NULL rejection, but only a second can
	// collide on 0007's unique digest index, which is what rules out a blanket
	// constant default.
	await harness.client.execute(
		`INSERT INTO screens (id, event_id, name, slug) VALUES
		 (1, 1, 'Main Stage', 'main'),
		 (2, 1, 'Side Stage', 'side')`,
	);
	await harness.client.execute(
		`INSERT INTO graphics_ingestion_operations (id, idempotency_key, source, initiated_by) VALUES
		 ('op-1', 'key-1', 'upload', 'author-1'),
		 ('op-2', 'key-2', 'upload', 'author-2')`,
	);
	return harness;
}

describe('the migration journal', () => {
	it('replays to the end against tables that already hold rows', async () => {
		const harness = await replayFromPopulated();
		try {
			await expect(harness.applyRemainingMigrations()).resolves.toBeUndefined();
		}
		finally {
			await harness.close();
		}
	});

	it('leaves every backfilled NOT NULL column non-null and its unique index intact', async () => {
		const harness = await replayFromPopulated();
		try {
			await harness.applyRemainingMigrations();

			const screens = await harness.client.execute(
				`SELECT id, asset_capability_seed AS seed, asset_capability_digest AS digest
				 FROM screens ORDER BY id`,
			);
			const seeds = screens.rows.map(row => String(row.seed));
			const digests = screens.rows.map(row => String(row.digest));
			expect(seeds).toHaveLength(2);
			expect(seeds.every(seed => seed.length > 0)).toBe(true);
			// The digest carries a unique index, so a backfill that repeated itself
			// would have failed the replay above; this states the requirement the
			// index enforces rather than leaving it implied.
			expect(new Set(digests).size).toBe(2);

			const operations = await harness.client.execute(
				'SELECT proposed_name FROM graphics_ingestion_operations',
			);
			expect(operations.rows).toHaveLength(2);
			expect(operations.rows.every(row => row.proposed_name !== null)).toBe(true);
		}
		finally {
			await harness.close();
		}
	});

	it('backfills a capability seed no one can predict from the row', async () => {
		// A restored Screen Output must not come back with a capability anybody
		// could derive from its id. The seed is the secret half; the digest only
		// has to be unique, and is deliberately shaped so that no real capability
		// can ever hash to it.
		const first = await replayFromPopulated();
		const second = await replayFromPopulated();
		try {
			await first.applyRemainingMigrations();
			await second.applyRemainingMigrations();
			const seedsOf = async (harness: Awaited<ReturnType<typeof replayFromPopulated>>) =>
				(await harness.client.execute(
					'SELECT asset_capability_seed AS seed FROM screens ORDER BY id',
				)).rows.map(row => String(row.seed));

			const firstSeeds = await seedsOf(first);
			const secondSeeds = await seedsOf(second);
			expect(new Set(firstSeeds).size).toBe(2);
			expect(firstSeeds).not.toEqual(secondSeeds);
		}
		finally {
			await first.close();
			await second.close();
		}
	});
});
