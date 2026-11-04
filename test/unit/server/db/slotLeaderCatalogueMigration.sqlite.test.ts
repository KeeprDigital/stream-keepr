import type { SqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * A Slot side's Leader stops being an inline snapshot and references the card
 * catalogue by number (ADR-0074). The migration builds the missing catalogue
 * rows from the snapshots the sides hold, with no lookup.
 */
describe('the Slot-side Leader catalogue migration', () => {
	let harness: SqliteD1Harness;

	afterEach(async () => {
		await harness.close();
	});

	const image = (number: string) => `https://cards-img.keepr.digital/${number}.png`;
	const leader = (number: string, name: string, colors: string[]) => ({
		number,
		name,
		colors,
		imageUrl: image(number),
	});
	const opSide = (name: string, sideLeader: unknown, extra: object = {}) => JSON.stringify({
		name,
		gameData: { type: 'op', leader: sideLeader, ...extra },
	});

	async function stageSides() {
		harness = await createSqliteD1Harness({ throughMigration: '0002' });
		await harness.client.execute(`
			INSERT INTO events (id, name, game, feature_match_orientation) VALUES (1, 'OP Regional', 'op', 'horizontal')
		`);
		// OP01-002 is already catalogued, from a pasted entry with fuller card data.
		await harness.client.execute(`
			INSERT INTO cards (name, game, card_number, category, colors, power, image_url)
			VALUES ('Trafalgar Law', 'op', 'OP01-002', 'leader', '["Red","Green"]', 5000, '${image('OP01-002')}')
		`);
		await harness.client.execute({
			sql: `INSERT INTO feature_match_slots (id, event_id, updated_at, player1_data, player2_data) VALUES
				(1, 1, 1000, ?, ?),
				(2, 1, 2000, ?, ?),
				(3, 1, 3000, ?, NULL)`,
			args: [
				opSide('Ana', leader('OP01-001', 'Zoro (old)', ['Red']), {
					featureMatchDeckList: { id: 7, mainboardCount: 50 },
				}),
				opSide('Ben', leader('OP01-002', 'Law (snapshot)', ['Red'])),
				opSide('Cat', leader('OP01-001', 'Roronoa Zoro', ['Red'])),
				opSide('Dan', 'Zoro typed before the picker'),
				opSide('Eve', null),
			],
		});
	}

	it('catalogues each uncatalogued Leader number from its latest side snapshot', async () => {
		await stageSides();
		await harness.applyRemainingMigrations();

		const result = await harness.client.execute(`
			SELECT name, game, card_number, category, colors, power, image_url FROM cards ORDER BY card_number
		`);

		expect(result.rows.map(row => ({ ...row }))).toEqual([
			{
				name: 'Roronoa Zoro',
				game: 'op',
				card_number: 'OP01-001',
				category: 'leader',
				colors: '["Red"]',
				power: null,
				image_url: image('OP01-001'),
			},
			{
				name: 'Trafalgar Law',
				game: 'op',
				card_number: 'OP01-002',
				category: 'leader',
				colors: '["Red","Green"]',
				power: 5000,
				image_url: image('OP01-002'),
			},
		]);
	});

	it('repoints each side\'s Leader to its card number, keeping the rest of the side', async () => {
		await stageSides();
		await harness.applyRemainingMigrations();

		const result = await harness.client.execute(`SELECT player1_data, player2_data FROM feature_match_slots ORDER BY id`);

		expect(result.rows.map(row => [row.player1_data, row.player2_data].map(data => data === null
			? null
			: JSON.parse(String(data))))).toEqual([
			[
				{
					name: 'Ana',
					gameData: {
						type: 'op',
						leader: { number: 'OP01-001' },
						featureMatchDeckList: { id: 7, mainboardCount: 50 },
					},
				},
				{
					name: 'Ben',
					gameData: {
						type: 'op',
						leader: { number: 'OP01-002' },
					},
				},
			],
			[
				{
					name: 'Cat',
					gameData: {
						type: 'op',
						leader: { number: 'OP01-001' },
					},
				},
				{
					name: 'Dan',
					gameData: { type: 'op', leader: 'Zoro typed before the picker' },
				},
			],
			[
				{
					name: 'Eve',
					gameData: { type: 'op', leader: null },
				},
				null,
			],
		]);
	});
});
