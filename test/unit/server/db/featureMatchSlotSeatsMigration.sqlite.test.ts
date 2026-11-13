import { afterAll, describe, expect, it } from 'vitest';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// A Slot from before Seats 3 and 4 keeps its two Seats and holds neither new one (ADR-0086).
const harness = await createSqliteD1Harness({ throughMigration: '0001' });

afterAll(async () => {
	await harness.close();
});

describe('the Feature Match Slot Seats migration', () => {
	it('leaves an existing Slot\'s two Seats as they were, with Seats 3 and 4 empty', async () => {
		await harness.client.execute(`
			INSERT INTO events (id, name, game, feature_match_orientation)
			VALUES (1, 'Magic', 'mtg', 'horizontal')
		`);
		await harness.client.execute(`
			INSERT INTO feature_match_slots (id, event_id, player1_data, player2_data)
			VALUES (1, 1, '{"name":"Ana"}', '{"name":"Ben"}')
		`);

		await harness.applyRemainingMigrations();

		const { rows } = await harness.client.execute('SELECT player1_data, player2_data, player3_data, player4_data FROM feature_match_slots');
		expect(rows.map(row => [
			row.player1_data,
			row.player2_data,
			row.player3_data,
			row.player4_data,
		])).toEqual([
			[
				'{"name":"Ana"}',
				'{"name":"Ben"}',
				null,
				null,
			],
		]);
	});
});
