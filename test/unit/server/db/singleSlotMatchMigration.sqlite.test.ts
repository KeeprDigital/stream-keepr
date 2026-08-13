import type { SqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * The single-Slot invariant lands on databases the defect it forbids has
 * already reached, so the migration that adds the index has to survive the
 * duplicates that index rejects. These hold `0025` back and arrange rows in the
 * shape only a pre-index database could hold, then apply it for real: the
 * repository's own migration files against real SQLite, because a migration
 * that only ever runs on an empty database is not the one that ships.
 */
describe('single-slot Match migration', () => {
	let harness: SqliteD1Harness;

	beforeEach(async () => {
		harness = await createSqliteD1Harness({ throughMigration: '0024' });
		await harness.client.execute(`
			INSERT INTO events (id, name, game, feature_match_orientation)
			VALUES (1, 'Replay Event', 'mtg', 'horizontal'), (2, 'Other Event', 'mtg', 'horizontal')
		`);
		await harness.client.execute(`
			INSERT INTO phases (id, event_id, name) VALUES (1, 1, 'Swiss')
		`);
		await harness.client.execute(`
			INSERT INTO rounds (id, event_id, phase_id, name, round_number)
			VALUES (1, 1, 1, 'Round 1', 1)
		`);
		await harness.client.execute(`
			INSERT INTO matches (id, event_id, round_id) VALUES (1, 1, 1), (2, 1, 1)
		`);
		await harness.client.execute(`
			INSERT INTO players (id, event_id, name) VALUES (1, 1, 'Ada'), (2, 1, 'Bo')
		`);
		// Slots 10 and 20 are the duplicate only a pre-index database could hold:
		// two lanes showing one Match. 30 holds a Match uncontested and 40 holds
		// none, so the migration can be caught touching what it should not.
		await harness.client.execute(`
			INSERT INTO feature_match_slots (
				id, event_id, match_id, external_id, table_number, round_name,
				format_name, player1_id, player2_id, player1_data, player2_data
			) VALUES
				(10, 1, 1, 'ext-10', 11, 'Round 1', 'Modern', 1, 2, '{"name":"Ada"}', '{"name":"Bo"}'),
				(20, 1, 1, 'ext-20', 22, 'Round 1', 'Modern', 1, 2, '{"name":"Ada"}', '{"name":"Bo"}'),
				(30, 1, 2, 'ext-30', 33, 'Round 1', 'Modern', 1, 2, '{"name":"Ada"}', '{"name":"Bo"}'),
				(40, 1, null, 'ext-40', 44, 'Round 1', 'Modern', null, null, null, null)
		`);
	});

	afterEach(async () => {
		await harness.close();
	});

	async function slotRow(id: number) {
		const result = await harness.client.execute({
			sql: `SELECT * FROM feature_match_slots WHERE id = ?`,
			args: [id],
		});
		return result.rows[0] as unknown as Record<string, unknown>;
	}

	it('applies to a database already holding a duplicate rather than failing on it', async () => {
		// The whole point of the dedupe: without it this rejects, and it rejects on
		// exactly the databases the defect reached.
		await expect(harness.applyRemainingMigrations()).resolves.toBeUndefined();
	});

	it('leaves the Match with the lowest Slot holding it and empties the rest', async () => {
		await harness.applyRemainingMigrations();

		expect(await slotRow(10)).toMatchObject({ match_id: 1, external_id: 'ext-10', table_number: 11 });
		// Emptied to the shape a promotion's own duplicate-clearing produces, not
		// merely detached from the Match.
		expect(await slotRow(20)).toMatchObject({
			match_id: null,
			external_id: null,
			external_source: null,
			table_number: null,
			round_name: null,
			format_name: null,
			player1_id: null,
			player2_id: null,
			player1_data: null,
			player2_data: null,
		});
	});

	it('leaves an uncontested Slot and an empty Slot alone', async () => {
		await harness.applyRemainingMigrations();

		// A Match held by one Slot is not a duplicate, and a Slot holding no Match
		// is not one either — a dedupe that swept either would destroy live lanes.
		expect(await slotRow(30)).toMatchObject({ match_id: 2, external_id: 'ext-30', table_number: 33 });
		expect(await slotRow(40)).toMatchObject({ match_id: null, external_id: 'ext-40', table_number: 44 });
	});

	it('forbids a second Slot from taking a Match once applied', async () => {
		await harness.applyRemainingMigrations();

		await expect(harness.client.execute(`
			INSERT INTO feature_match_slots (id, event_id, match_id) VALUES (50, 1, 1)
		`)).rejects.toThrow(/UNIQUE constraint failed/);
	});

	it('still lets any number of Slots hold no Match', async () => {
		await harness.applyRemainingMigrations();

		// Why the index is partial: an unoccupied Slot carries a null Match, and an
		// event runs several of them at once.
		await expect(harness.client.execute(`
			INSERT INTO feature_match_slots (id, event_id, match_id)
			VALUES (60, 1, null), (70, 1, null)
		`)).resolves.toBeDefined();
	});
});
