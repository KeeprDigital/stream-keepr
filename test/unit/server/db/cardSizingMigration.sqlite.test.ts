import type { SqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * `dynamicCardSize` became `cardSizing` (ADR-0053): a stored `true` reads as
 * Fit and `false` as Fixed, so no Screen loses its sizing. A mainboard can no
 * longer stack, so a stored mainboard stack becomes a grid.
 */
describe('the card sizing migration', () => {
	let harness: SqliteD1Harness;

	afterEach(async () => {
		await harness.close();
	});

	async function migrate(modeConfigs: unknown) {
		harness = await createSqliteD1Harness({ throughMigration: '0013' });
		await harness.client.execute(`
			INSERT INTO events (id, name, game, feature_match_orientation)
			VALUES (1, 'Existing Event', 'mtg', 'horizontal')
		`);
		await harness.client.execute({
			sql: `
				INSERT INTO screens (id, event_id, name, slug, current_mode, mode_configs, asset_capability_seed, asset_capability_digest)
				VALUES (1, 1, 'Screen 1', 'screen-1', 'deck', ?, 'seed-1', 'digest-1')
			`,
			args: [
				modeConfigs === null
					? null
					: JSON.stringify(modeConfigs),
			],
		});
		await harness.applyRemainingMigrations();
		const result = await harness.client.execute('SELECT mode_configs FROM screens WHERE id = 1');
		const stored = result.rows[0]!.mode_configs;
		return stored === null
			? null
			: JSON.parse(String(stored));
	}

	it.each([
		{
			name: 'a filling Most Played Cards grid fits',
			before: {
				'top-cards': { dynamicCardSize: true, columns: 5 },
			},
			after: {
				'top-cards': { cardSizing: 'fit', columns: 5 },
			},
		},
		{
			name: 'a fixed Most Played Cards grid stays fixed',
			before: {
				'top-cards': { dynamicCardSize: false },
			},
			after: {
				'top-cards': { cardSizing: 'fixed' },
			},
		},
		{
			name: 'each Deck board keeps its sizing, and a mainboard stack becomes a grid',
			before: {
				deck: {
					mainboard: { view: 'stack', dynamicCardSize: true },
					sideboard: { view: 'stack', dynamicCardSize: false },
				},
			},
			after: {
				deck: {
					mainboard: { view: 'grid', cardSizing: 'fit' },
					sideboard: { view: 'stack', cardSizing: 'fixed' },
				},
			},
		},
		{
			name: 'a Deck board that never set its sizing is left alone',
			before: {
				deck: {
					mainboard: { columns: 6 },
				},
			},
			after: {
				deck: {
					mainboard: { columns: 6 },
				},
			},
		},
		{
			name: 'another mode is left alone',
			before: {
				standings: { columns: [] },
			},
			after: {
				standings: { columns: [] },
			},
		},
		{
			name: 'a Screen with no mode configs is left alone',
			before: null,
			after: null,
		},
	])('$name', async ({ before, after }) => {
		expect(await migrate(before)).toEqual(after);
	});
});
