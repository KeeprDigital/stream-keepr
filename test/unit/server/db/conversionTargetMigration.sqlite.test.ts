import type { SqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * Every Metagame read counts Conversion Rate against its Event's Conversion
 * Target (ADR-0061), and deployed installations' Events have none yet.
 */
describe('the Conversion Target migration', () => {
	let harness: SqliteD1Harness;

	afterEach(async () => {
		await harness.close();
	});

	it('gives an existing Event the default Top 8 target', async () => {
		harness = await createSqliteD1Harness({ throughMigration: '0015' });
		await harness.client.execute(`
			INSERT INTO events (id, name, game, feature_match_orientation)
			VALUES (1, 'Existing Event', 'mtg', 'horizontal')
		`);
		await harness.applyRemainingMigrations();

		const result = await harness.client.execute('SELECT conversion_metric, conversion_threshold FROM events WHERE id = 1');

		expect(result.rows[0]).toMatchObject({ conversion_metric: 'topN', conversion_threshold: 8 });
	});
});
