import type { SqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * A Screen holds no look of its own (#826, ADR-0051): its stored background,
 * text colours, padding, alignment and colour mode are dropped, not migrated,
 * and the rest of the Screen survives.
 */
describe('the Screen look drop migration', () => {
	let harness: SqliteD1Harness;

	afterEach(async () => {
		await harness.close();
	});

	it.each([
		[
			'a populated',
			{
				paddingX: 32,
				background: '#101010',
				colorMode: 'dark',
				horizontalAlign: 'left',
			},
		],
		['an empty', {}],
		['no', null],
	])('keeps a Screen that had %s look of its own, without it', async (_case, screenConfig) => {
		harness = await createSqliteD1Harness({ throughMigration: '0000' });
		await harness.client.execute(`
			INSERT INTO events (id, name, game, feature_match_orientation)
			VALUES (1, 'Existing Event', 'mtg', 'horizontal')
		`);
		await harness.client.execute({
			sql: `
				INSERT INTO screens (id, event_id, name, slug, current_mode, mode_configs, screen_config, asset_capability_seed, asset_capability_digest)
				VALUES (1, 1, 'Main', 'main', 'standings', ?, ?, 'seed', 'digest')
			`,
			args: [
				JSON.stringify({
					standings: { rowsPerPage: 6 },
				}),
				screenConfig === null
					? null
					: JSON.stringify(screenConfig),
			],
		});

		await harness.applyRemainingMigrations();

		const result = await harness.client.execute('SELECT * FROM screens WHERE id = 1');
		const row = result.rows[0]!;
		expect(Object.keys(row)).not.toContain('screen_config');
		expect({
			slug: row.slug,
			currentMode: row.current_mode,
			modeConfigs: JSON.parse(String(row.mode_configs)),
		}).toEqual({
			slug: 'main',
			currentMode: 'standings',
			modeConfigs: {
				standings: { rowsPerPage: 6 },
			},
		});
	});
});
