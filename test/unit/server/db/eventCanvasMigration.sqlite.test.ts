import type { SqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * Every Screen renders in its Event's Event Canvas (#821, ADR-0051), and
 * deployed installations' Events have no canvas yet.
 */
describe('the Event Canvas migration', () => {
	let harness: SqliteD1Harness;

	afterEach(async () => {
		await harness.close();
	});

	it('gives an existing Event the default 1920×1080 canvas', async () => {
		harness = await createSqliteD1Harness({ throughMigration: '0007' });
		await harness.client.execute(`
			INSERT INTO events (id, name, game, feature_match_orientation)
			VALUES (1, 'Existing Event', 'mtg', 'horizontal')
		`);
		await harness.applyRemainingMigrations();

		const result = await harness.client.execute('SELECT canvas_width, canvas_height FROM events WHERE id = 1');

		expect(result.rows[0]).toMatchObject({ canvas_width: 1920, canvas_height: 1080 });
	});
});
