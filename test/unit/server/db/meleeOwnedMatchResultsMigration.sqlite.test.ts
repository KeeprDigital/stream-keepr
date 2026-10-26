import type { SqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * A Match's result is Melee's alone (ADR-0047). Deployed installations hold
 * results an operator entered on manual Matches, and Melee-synced Matches whose
 * zero game wins and game draws Melee sent as null.
 */
describe('the Melee-owned Match result migration', () => {
	let harness: SqliteD1Harness;

	afterEach(async () => {
		await harness.close();
	});

	interface StoredMatch {
		externalSource: 'melee' | 'manual' | null;
		hasResult: boolean;
		isBye?: boolean;
		gameWins: [number | null, number | null];
		gameDraws: number | null;
		resultString?: string | null;
	}

	async function insertStructure() {
		await harness.client.execute(`
			INSERT INTO events (id, name, game, feature_match_orientation)
			VALUES (1, 'Existing Event', 'mtg', 'horizontal')
		`);
		await harness.client.execute(`INSERT INTO phases (id, event_id, name) VALUES (1, 1, 'Swiss')`);
		await harness.client.execute(`INSERT INTO rounds (id, event_id, phase_id, name, round_number) VALUES (1, 1, 1, 'Round 1', 1)`);
	}

	async function insertMatch(id: number, match: StoredMatch) {
		await harness.client.execute({
			sql: `
				INSERT INTO matches (id, event_id, round_id, external_id, external_source, has_result, is_bye, player1_game_wins, player2_game_wins, game_draws, result_string)
				VALUES (?, 1, 1, ?, ?, ?, ?, ?, ?, ?, ?)
			`,
			args: [
				id,
				match.externalSource === 'melee'
					? `guid-${id}`
					: null,
				match.externalSource,
				match.hasResult
					? 1
					: 0,
				match.isBye
					? 1
					: 0,
				match.gameWins[0],
				match.gameWins[1],
				match.gameDraws,
				match.resultString ?? null,
			],
		});
	}

	async function readMatch(id: number) {
		const result = await harness.client.execute({
			sql: 'SELECT * FROM matches WHERE id = ?',
			args: [id],
		});
		const row = result.rows[0]!;
		return {
			hasResult: Boolean(row.has_result),
			isBye: Boolean(row.is_bye),
			gameWins: [row.player1_game_wins, row.player2_game_wins],
			gameDraws: row.game_draws,
		};
	}

	it('gives a reported Melee Match the zero game wins and game draws Melee sent as null', async () => {
		harness = await createSqliteD1Harness({ throughMigration: '0004' });
		await insertStructure();
		await insertMatch(1, {
			externalSource: 'melee',
			hasResult: true,
			gameWins: [2, null],
			gameDraws: 0,
			resultString: 'Kim Fields won 2-0-0',
		});
		await insertMatch(2, {
			externalSource: 'melee',
			hasResult: true,
			gameWins: [null, 2],
			gameDraws: null,
		});
		await insertMatch(3, {
			externalSource: 'melee',
			hasResult: true,
			gameWins: [1, 1],
			gameDraws: 1,
		});

		await harness.applyRemainingMigrations();

		expect(await readMatch(1)).toEqual({
			hasResult: true,
			isBye: false,
			gameWins: [2, 0],
			gameDraws: 0,
		});
		expect(await readMatch(2)).toEqual({
			hasResult: true,
			isBye: false,
			gameWins: [0, 2],
			gameDraws: 0,
		});
		expect(await readMatch(3)).toEqual({
			hasResult: true,
			isBye: false,
			gameWins: [1, 1],
			gameDraws: 1,
		});
	});

	it('leaves an unreported Melee Match and a bye without a Game Score', async () => {
		harness = await createSqliteD1Harness({ throughMigration: '0004' });
		await insertStructure();
		await insertMatch(1, {
			externalSource: 'melee',
			hasResult: false,
			gameWins: [null, null],
			gameDraws: 1,
			resultString: '0-0-1 Draw',
		});
		await insertMatch(2, {
			externalSource: 'melee',
			hasResult: true,
			isBye: true,
			gameWins: [null, null],
			gameDraws: 0,
		});

		await harness.applyRemainingMigrations();

		expect(await readMatch(1)).toEqual({
			hasResult: false,
			isBye: false,
			gameWins: [null, null],
			gameDraws: null,
		});
		expect(await readMatch(2)).toEqual({
			hasResult: true,
			isBye: true,
			gameWins: [null, null],
			gameDraws: null,
		});
	});

	it('clears a result an operator entered on a manual Match', async () => {
		harness = await createSqliteD1Harness({ throughMigration: '0004' });
		await insertStructure();
		await insertMatch(1, {
			externalSource: 'manual',
			hasResult: true,
			gameWins: [2, 1],
			gameDraws: 0,
			resultString: '2-1',
		});
		await insertMatch(2, {
			externalSource: null,
			hasResult: true,
			isBye: true,
			gameWins: [null, null],
			gameDraws: null,
		});

		await harness.applyRemainingMigrations();

		expect(await readMatch(1)).toEqual({
			hasResult: false,
			isBye: false,
			gameWins: [null, null],
			gameDraws: null,
		});
		expect(await readMatch(2)).toEqual({
			hasResult: false,
			isBye: false,
			gameWins: [null, null],
			gameDraws: null,
		});
	});

	it('no longer keeps Melee\'s result text', async () => {
		harness = await createSqliteD1Harness({ throughMigration: '0004' });
		await insertStructure();
		await insertMatch(1, {
			externalSource: 'melee',
			hasResult: true,
			gameWins: [2, 0],
			gameDraws: 0,
			resultString: 'Kim Fields won 2-0-0',
		});

		await harness.applyRemainingMigrations();

		const result = await harness.client.execute('SELECT name FROM pragma_table_info(\'matches\')');
		expect(result.rows.map(row => row.name)).not.toContain('result_string');
	});
});
