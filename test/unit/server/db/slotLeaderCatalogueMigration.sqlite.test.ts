import type { SqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * A Slot side's Leader references the card catalogue by number (ADR-0074).
 * Deployed installations hold a Leader only as typed text, which names no
 * card: the migration passes over those sides and catalogues nothing.
 */
describe('the Slot-side Leader catalogue migration', () => {
	let harness: SqliteD1Harness;

	afterEach(async () => {
		await harness.close();
	});

	it('leaves the sides a deployed installation holds as they were', async () => {
		const sides = [
			[
				{
					name: 'Ana',
					gameData: { type: 'op', leader: 'Roronoa Zoro' },
				},
				{
					name: 'Ben',
					gameData: { type: 'op', leader: null },
				},
			],
			[
				{
					name: 'Cat',
					gameData: { type: 'mtg', deckName: 'Burn', deckColors: 'R' },
				},
				{
					name: 'Dan',
					gameData: { type: 'op' },
				},
			],
			[
				{ name: 'Eve' },
				null,
			],
		];
		harness = await createSqliteD1Harness({ throughMigration: '0000' });
		await harness.client.execute(`
			INSERT INTO events (id, name, game, feature_match_orientation) VALUES (1, 'OP Regional', 'op', 'horizontal')
		`);
		for (const [index, [player1, player2]] of sides.entries()) {
			await harness.client.execute({
				sql: 'INSERT INTO feature_match_slots (id, event_id, player1_data, player2_data) VALUES (?, 1, ?, ?)',
				args: [
					index + 1,
					JSON.stringify(player1),
					player2 === null
						? null
						: JSON.stringify(player2),
				],
			});
		}

		await harness.applyRemainingMigrations();

		const slots = await harness.client.execute('SELECT player1_data, player2_data FROM feature_match_slots ORDER BY id');
		expect(slots.rows.map(row => [row.player1_data, row.player2_data].map(data => data === null
			? null
			: JSON.parse(String(data))))).toEqual(sides);
		const catalogued = await harness.client.execute('SELECT card_number FROM cards');
		expect(catalogued.rows).toEqual([]);
	});
});
