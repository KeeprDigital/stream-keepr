import type { SqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

describe('deck source migration', () => {
	let harness: SqliteD1Harness;

	beforeEach(async () => {
		harness = await createSqliteD1Harness({ throughMigration: '0029' });
		await harness.client.execute(`
			INSERT INTO events (id, name, game, feature_match_orientation)
			VALUES (1, 'Migration Event', 'mtg', 'horizontal')
		`);
		await harness.client.execute(`
			INSERT INTO screens (
				id, event_id, name, slug, current_mode, mode_configs,
				asset_capability_seed, asset_capability_digest
			) VALUES
				(1, 1, 'Selected', 'selected', 'deck',
					'{"deck":{"playerId":17,"board":"sideboard","showDeckName":false,"mainboard":{"columns":6}},"card":{"scale":1.5}}',
					'seed-1', 'digest-1'),
				(2, 1, 'No Player', 'no-player', 'deck',
					'{"deck":{"playerId":null,"showDeckColors":false}}',
					'seed-2', 'digest-2'),
				(3, 1, 'Other Mode', 'other-mode', 'card',
					'{"card":{"scale":2}}',
					'seed-3', 'digest-3'),
				(4, 1, 'No Deck Config', 'no-deck-config', 'deck', NULL,
					'seed-4', 'digest-4')
		`);
	});

	afterEach(async () => await harness.close());

	async function configs(id: number): Promise<Record<string, unknown> | null> {
		const result = await harness.client.execute({
			sql: 'SELECT mode_configs FROM screens WHERE id = ?',
			args: [id],
		});
		const value = result.rows[0]?.mode_configs;
		return value === null ? null : JSON.parse(String(value));
	}

	it('rewrites Player bindings without changing any other stored value', async () => {
		await harness.applyRemainingMigrations();

		expect(await configs(1)).toEqual({
			deck: {
				deckSource: { type: 'player', playerId: 17 },
				board: 'sideboard',
				showDeckName: false,
				mainboard: { columns: 6 },
			},
			card: { scale: 1.5 },
		});
		expect(await configs(2)).toEqual({
			deck: { deckSource: { type: 'player', playerId: null }, showDeckColors: false },
		});
		expect(await configs(3)).toEqual({ card: { scale: 2 } });
		expect(await configs(4)).toBeNull();
	});
});
