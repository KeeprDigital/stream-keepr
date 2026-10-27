import type { SqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * A Screen had its own width and height; every Screen now renders in its Event's
 * Event Canvas (#821, ADR-0051). Deployed installations store the old fields in a
 * Screen's own configuration, and their Events have no canvas yet.
 */
describe('the Event Canvas migration', () => {
	let harness: SqliteD1Harness;

	afterEach(async () => {
		await harness.close();
	});

	async function arrange(screenConfigs: Array<unknown>) {
		harness = await createSqliteD1Harness({ throughMigration: '0007' });
		await harness.client.execute(`
			INSERT INTO events (id, name, game, feature_match_orientation)
			VALUES (1, 'Existing Event', 'mtg', 'horizontal')
		`);
		for (const [index, screenConfig] of screenConfigs.entries()) {
			const id = index + 1;
			await harness.client.execute({
				sql: `
					INSERT INTO screens (id, event_id, name, slug, current_mode, screen_config, asset_capability_seed, asset_capability_digest)
					VALUES (?, 1, ?, ?, 'standings', ?, ?, ?)
				`,
				args: [
					id,
					`Screen ${id}`,
					`screen-${id}`,
					screenConfig === null
						? null
						: JSON.stringify(screenConfig),
					`seed-${id}`,
					`digest-${id}`,
				],
			});
		}
		await harness.applyRemainingMigrations();
	}

	async function storedScreenConfigs() {
		const result = await harness.client.execute('SELECT screen_config FROM screens ORDER BY id');
		return result.rows.map(row => row.screen_config === null
			? null
			: JSON.parse(String(row.screen_config)));
	}

	it('gives an existing Event the default 1920×1080 canvas', async () => {
		await arrange([]);

		const result = await harness.client.execute('SELECT canvas_width, canvas_height FROM events WHERE id = 1');

		expect(result.rows[0]).toMatchObject({ canvas_width: 1920, canvas_height: 1080 });
	});

	it('drops a Screen\'s own width and height, keeping the rest of its configuration', async () => {
		await arrange([
			{
				width: 1280,
				height: 720,
				paddingX: 32,
				background: '#101010',
			},
			{ height: 1080 },
			{ paddingY: 8 },
			null,
		]);

		expect(await storedScreenConfigs()).toEqual([
			{ paddingX: 32, background: '#101010' },
			{},
			{ paddingY: 8 },
			null,
		]);
	});
});
