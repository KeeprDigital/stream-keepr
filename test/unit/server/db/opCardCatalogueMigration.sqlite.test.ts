import type { SqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * Pasted Feature Match Deck List entries stop carrying card snapshots and
 * reference the card catalogue by number (ADR-0074). The migration builds the
 * catalogue's One Piece rows from the snapshots already stored, with no lookup.
 */
describe('the One Piece card catalogue migration', () => {
	let harness: SqliteD1Harness;

	afterEach(async () => {
		await harness.close();
	});

	async function stageSnapshots() {
		harness = await createSqliteD1Harness({ throughMigration: '0001' });
		await harness.client.execute(`
			INSERT INTO events (id, name, game, feature_match_orientation) VALUES (1, 'OP Regional', 'op', 'horizontal')
		`);
		await harness.client.execute(`INSERT INTO feature_match_slots (id, event_id) VALUES (1, 1)`);
		await harness.client.execute(`
			INSERT INTO feature_match_deck_lists (id, event_id, slot_id, source_text, mainboard_count)
			VALUES (1, 1, 1, 'first', 8), (2, 1, 1, 'second', 4)
		`);
		await harness.client.execute(`
			INSERT INTO cards (id, name, game, colors) VALUES (1, 'Roronoa Zoro', 'mtg', 'G')
		`);
		await harness.client.execute(`
			INSERT INTO feature_match_deck_list_entries
				(deck_list_id, sort_order, quantity, card_number, name, category, colors, cost, power, counter, image_url)
			VALUES
				(1, 0, 1, 'OP01-001', 'Roronoa Zoro', 'leader', '["Red"]', NULL, 5000, NULL, 'https://cards-img.keepr.digital/OP01-001.png'),
				(1, 1, 4, 'OP01-025', 'Zoro (old)', 'character', '["Red"]', 3, 5000, 1000, 'https://cards-img.keepr.digital/OP01-025.png'),
				(1, 2, 4, 'OP99-999', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
				(2, 0, 4, 'OP01-025', 'Roronoa Zoro', 'character', '["Red"]', 3, 6000, 1000, 'https://cards-img.keepr.digital/OP01-025.png')
		`);
	}

	it('builds one catalogue row per snapshotted number, from its latest snapshot', async () => {
		await stageSnapshots();
		await harness.applyRemainingMigrations();

		const result = await harness.client.execute(`
			SELECT name, game, card_number, category, colors, cost, power, counter, image_url
			FROM cards ORDER BY game, card_number
		`);

		expect(result.rows).toEqual([
			expect.objectContaining({
				name: 'Roronoa Zoro',
				game: 'mtg',
				card_number: null,
				colors: 'G',
			}),
			expect.objectContaining({
				name: 'Roronoa Zoro',
				game: 'op',
				card_number: 'OP01-001',
				category: 'leader',
				colors: '["Red"]',
				cost: null,
				power: 5000,
				counter: null,
				image_url: 'https://cards-img.keepr.digital/OP01-001.png',
			}),
			expect.objectContaining({
				name: 'Roronoa Zoro',
				game: 'op',
				card_number: 'OP01-025',
				category: 'character',
				cost: 3,
				power: 6000,
				counter: 1000,
			}),
		]);
	});

	it('keeps every entry\'s number and quantity, each finding its card in the catalogue', async () => {
		await stageSnapshots();
		await harness.applyRemainingMigrations();

		const result = await harness.client.execute(`
			SELECT e.deck_list_id, e.card_number, e.quantity, c.name
			FROM feature_match_deck_list_entries e
			LEFT JOIN cards c ON c.game = 'op' AND c.card_number = e.card_number
			ORDER BY e.deck_list_id, e.sort_order
		`);

		expect(result.rows.map(row => ({ ...row }))).toEqual([
			{
				deck_list_id: 1,
				card_number: 'OP01-001',
				quantity: 1,
				name: 'Roronoa Zoro',
			},
			{
				deck_list_id: 1,
				card_number: 'OP01-025',
				quantity: 4,
				name: 'Roronoa Zoro',
			},
			{
				deck_list_id: 1,
				card_number: 'OP99-999',
				quantity: 4,
				name: null,
			},
			{
				deck_list_id: 2,
				card_number: 'OP01-025',
				quantity: 4,
				name: 'Roronoa Zoro',
			},
		]);
	});
});
