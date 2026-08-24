import type { SqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * The Background Screen's mode rename lands on databases that hold `idle`
 * Screens with stored Idle configurations, so `0028` is applied here for real —
 * the repository's own migration files against real SQLite — over rows only a
 * pre-rename database could hold. The old configuration must reset rather than
 * map (the ADR-0014 reset precedent), and every other mode's rows and stored
 * configurations must come through untouched.
 */
describe('background-replaces-idle migration', () => {
	let harness: SqliteD1Harness;

	beforeEach(async () => {
		harness = await createSqliteD1Harness({ throughMigration: '0027' });
		await harness.client.execute(`
			INSERT INTO events (id, name, game, feature_match_orientation)
			VALUES (1, 'Replay Event', 'mtg', 'horizontal')
		`);
		// Screen 1 is the rename case: an idle Screen carrying the old Idle
		// configuration beside another mode's, so the reset can be caught
		// sweeping a neighbour. Screen 2 holds a different mode with no idle
		// key anywhere, so the migration can be caught touching what it should not.
		await harness.client.execute(`
			INSERT INTO screens (
				id, event_id, name, slug, current_mode, mode_configs,
				asset_capability_seed, asset_capability_digest
			) VALUES
				(1, 1, 'Stage Left', 'stage-left', 'idle',
					'{"idle":{"mediaBackground":{"enabled":true,"type":"video","url":"/loop.mp4","fit":"cover","opacity":1,"playbackRate":1,"loop":true}},"card":{"scale":2}}',
					'seed-1', 'digest-1'),
				(2, 1, 'Feature', 'feature', 'feature-match-overlay', '{"card":{"scale":3}}',
					'seed-2', 'digest-2')
		`);
	});

	afterEach(async () => {
		await harness.close();
	});

	async function screenRow(id: number) {
		const result = await harness.client.execute({
			sql: `SELECT current_mode, mode_configs FROM screens WHERE id = ?`,
			args: [id],
		});
		return result.rows[0] as unknown as { current_mode: string; mode_configs: string | null };
	}

	it('holds the pre-rename shape before the migration, so the assertions below measure the migration', async () => {
		expect((await screenRow(1)).current_mode).toBe('idle');
		expect(JSON.parse((await screenRow(1)).mode_configs!)).toHaveProperty('idle');
	});

	it('renames a stored idle mode to background', async () => {
		await harness.applyRemainingMigrations();

		expect((await screenRow(1)).current_mode).toBe('background');
	});

	it('resets the old Idle configuration rather than mapping it onto a Background Layer', async () => {
		await harness.applyRemainingMigrations();

		const configs = JSON.parse((await screenRow(1)).mode_configs!);
		expect(configs).not.toHaveProperty('idle');
		expect(configs).not.toHaveProperty('background');
	});

	it('leaves every other mode\'s stored configuration and current mode untouched', async () => {
		await harness.applyRemainingMigrations();

		expect(JSON.parse((await screenRow(1)).mode_configs!)).toMatchObject({ card: { scale: 2 } });
		const other = await screenRow(2);
		expect(other.current_mode).toBe('feature-match-overlay');
		expect(JSON.parse(other.mode_configs!)).toEqual({ card: { scale: 3 } });
	});

	it('defaults a new Screen to background once applied', async () => {
		await harness.applyRemainingMigrations();

		await harness.client.execute(`
			INSERT INTO screens (id, event_id, name, slug, asset_capability_seed, asset_capability_digest)
			VALUES (3, 1, 'Fresh', 'fresh', 'seed-3', 'digest-3')
		`);
		expect((await screenRow(3)).current_mode).toBe('background');
	});
});
