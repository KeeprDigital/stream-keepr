import type { SqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * What the baseline migration carries beyond the tables drizzle-kit generates:
 * its hand-written seed row, plus the database-level invariants the per-migration
 * suites proved before the history was squashed. Re-squashing that drops any of
 * these fails here.
 */
describe('the baseline migration', () => {
	let harness: SqliteD1Harness;

	beforeEach(async () => {
		harness = await createSqliteD1Harness();
		await harness.client.execute(`
			INSERT INTO events (id, name, game, feature_match_orientation)
			VALUES (1, 'Baseline Event', 'mtg', 'horizontal')
		`);
	});

	afterEach(async () => {
		await harness.close();
	});

	it('seeds the single Graphics capacity row', async () => {
		const result = await harness.client.execute('SELECT id FROM graphics_capacity_settings');
		expect(result.rows.map(row => Number(row.id))).toEqual([1]);
	});

	it('defaults a new Screen to background', async () => {
		await harness.client.execute(`
			INSERT INTO screens (id, event_id, name, slug, asset_capability_seed, asset_capability_digest)
			VALUES (1, 1, 'Fresh', 'fresh', 'seed-1', 'digest-1')
		`);
		const result = await harness.client.execute('SELECT current_mode FROM screens WHERE id = 1');
		expect(result.rows[0]?.current_mode).toBe('background');
	});

	it('forbids a second Slot from taking a Match', async () => {
		await harness.client.execute(`INSERT INTO phases (id, event_id, name) VALUES (1, 1, 'Swiss')`);
		await harness.client.execute(`
			INSERT INTO rounds (id, event_id, phase_id, name, round_number) VALUES (1, 1, 1, 'Round 1', 1)
		`);
		await harness.client.execute(`INSERT INTO matches (id, event_id, round_id) VALUES (1, 1, 1)`);
		await harness.client.execute(`INSERT INTO feature_match_slots (id, event_id, match_id) VALUES (10, 1, 1)`);

		await expect(harness.client.execute(`
			INSERT INTO feature_match_slots (id, event_id, match_id) VALUES (20, 1, 1)
		`)).rejects.toThrow(/UNIQUE constraint failed/);
	});

	it('still lets any number of Slots hold no Match', async () => {
		// Why the index is partial: an unoccupied Slot carries a null Match, and an
		// event runs several of them at once.
		await expect(harness.client.execute(`
			INSERT INTO feature_match_slots (id, event_id, match_id)
			VALUES (60, 1, null), (70, 1, null)
		`)).resolves.toBeDefined();
	});

	it('rejects a Screen whose Deck source names another Event\'s Player', async () => {
		await harness.client.execute(`
			INSERT INTO events (id, name, game, feature_match_orientation)
			VALUES (2, 'Other Event', 'mtg', 'horizontal')
		`);
		await harness.client.execute(`INSERT INTO players (id, event_id, name) VALUES (7, 2, 'Ada')`);

		await expect(harness.client.execute(`
			INSERT INTO screens (id, event_id, name, slug, current_mode, mode_configs, asset_capability_seed, asset_capability_digest)
			VALUES (1, 1, 'Deck', 'deck', 'deck', '{"deck":{"deckSource":{"type":"player","playerId":7}}}', 'seed-1', 'digest-1')
		`)).rejects.toThrow(/SCREEN_DECK_SOURCE_CONFLICT/);
	});
});
