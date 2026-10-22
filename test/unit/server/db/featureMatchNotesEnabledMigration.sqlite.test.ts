import type { SqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

describe('the Feature Match Notes toggle migration', () => {
	let harness: SqliteD1Harness;

	afterEach(async () => {
		await harness.close();
	});

	it('keeps Feature Match Notes on for an Event that existed before it', async () => {
		harness = await createSqliteD1Harness({ throughMigration: '0001' });
		await harness.client.execute(`
			INSERT INTO events (id, name, game, feature_match_orientation)
			VALUES (1, 'Existing Event', 'mtg', 'horizontal')
		`);

		await harness.applyRemainingMigrations();

		const result = await harness.client.execute('SELECT feature_match_notes_enabled FROM events WHERE id = 1');
		expect(Number(result.rows[0]?.feature_match_notes_enabled)).toBe(1);
	});
});
