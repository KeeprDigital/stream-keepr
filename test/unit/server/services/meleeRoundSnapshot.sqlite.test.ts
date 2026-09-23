import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const client = createClient({ url: 'file::memory:' });
const sqliteDb = drizzle(client);

vi.doMock('~~/server/db', () => ({ db: sqliteDb }));

const { meleeRoundSnapshotService } = await import('~~/server/services/meleeRoundSnapshot');

describe('meleeRoundSnapshotService JSON bulk SQLite integration', () => {
	beforeAll(async () => {
		for (const statement of [
			`create table rounds (
				id integer primary key autoincrement, event_id integer not null, phase_id integer not null,
				external_id text, external_source text, name text not null, round_number integer not null,
				control_mode text not null default 'default', last_synced_at integer,
				created_at integer not null default (unixepoch() * 1000),
				updated_at integer not null default (unixepoch() * 1000)
			)`,
			`create table matches (
				id integer primary key autoincrement, event_id integer not null, round_id integer not null,
				external_id text, external_source text, table_number integer, player1_id integer,
				player2_id integer, player1_data text, player2_data text, has_result integer not null default 0,
				player1_game_wins integer, player2_game_wins integer, game_draws integer,
				is_bye integer not null default 0, result_string text, sort_order integer not null default 0,
				created_at integer not null default (unixepoch() * 1000),
				updated_at integer not null default (unixepoch() * 1000),
				unique (event_id, external_id, external_source)
			)`,
			`create table player_round_standings (
				id integer primary key autoincrement, event_id integer not null, player_id integer not null,
				round_id integer not null, wins integer, losses integer, draws integer, position integer,
				points integer, created_at integer not null default (unixepoch() * 1000),
				updated_at integer not null default (unixepoch() * 1000), unique (player_id, round_id)
			)`,
		]) {
			await client.execute(statement);
		}
		await client.execute('insert into rounds (event_id, phase_id, external_id, external_source, name, round_number) values (1, 1, \'round-1\', \'melee\', \'Round 1\', 1)');
	});

	afterAll(async () => await client.close());

	it('bulk-replaces matches and standings with deterministic create/update/stale counts', async () => {
		const service = meleeRoundSnapshotService();
		const first = await service.replace({
			eventId: 1,
			roundId: 1,
			matches: [
				{ eventId: 1, roundId: 1, externalId: 'match-1', externalSource: 'melee', player1Data: { name: 'One' }, sortOrder: 0 },
				{ eventId: 1, roundId: 1, externalId: 'match-2', externalSource: 'melee', player1Data: { name: 'Two' }, sortOrder: 1 },
			],
			standings: [
				{ playerId: 10, wins: 1, losses: 0, draws: 0, position: 1, points: 3 },
				{ playerId: 20, wins: 0, losses: 1, draws: 0, position: 2, points: 0 },
			],
		});
		expect(first).toMatchObject({ created: 2, updated: 0, staleDeleted: 0 });

		const second = await service.replace({
			eventId: 1,
			roundId: 1,
			matches: [{
				eventId: 1,
				roundId: 1,
				externalId: 'match-2',
				externalSource: 'melee',
				player1Data: { name: 'Two Updated' },
				sortOrder: 0,
			}],
			standings: [{ playerId: 20, wins: 1, losses: 0, draws: 0, position: 1, points: 3 }],
		});
		expect(second).toMatchObject({ created: 0, updated: 1, staleDeleted: 1 });
		expect(second.matches[0]!.player1Data).toEqual({ name: 'Two Updated' });
		expect((await client.execute('select count(*) as count from matches')).rows[0]!.count).toBe(1);
		expect((await client.execute('select count(*) as count from player_round_standings')).rows[0]!.count).toBe(1);
	});

	it('scopes the existing-match probe and stale sweep to the snapshot\'s Event (#468)', async () => {
		// A second Event whose Round holds the identical Melee external id.
		// Event 1's `match-2` (updated above) must be invisible to it.
		await client.execute('insert into rounds (event_id, phase_id, external_id, external_source, name, round_number) values (2, 2, \'round-1\', \'melee\', \'Round 1\', 1)');

		const service = meleeRoundSnapshotService();
		const first = await service.replace({
			eventId: 2,
			roundId: 2,
			matches: [{ eventId: 2, roundId: 2, externalId: 'match-2', externalSource: 'melee', player1Data: { name: 'Other Show' }, sortOrder: 0 }],
			standings: [{ playerId: 30, wins: 1, losses: 0, draws: 0, position: 1, points: 3 }],
		});
		// Created, not updated: the colliding external id belongs to Event 1.
		expect(first).toMatchObject({ created: 1, updated: 0, staleDeleted: 0 });

		const second = await service.replace({
			eventId: 2,
			roundId: 2,
			matches: [{ eventId: 2, roundId: 2, externalId: 'match-3', externalSource: 'melee', player1Data: { name: 'Replacement' }, sortOrder: 0 }],
			standings: [{ playerId: 30, wins: 1, losses: 0, draws: 0, position: 1, points: 3 }],
		});
		// The stale sweep removes Event 2's own `match-2` and nothing else.
		expect(second).toMatchObject({ created: 1, updated: 0, staleDeleted: 1 });

		const eventOneMatches = await client.execute('select external_id, player1_data from matches where event_id = 1');
		expect(eventOneMatches.rows).toMatchObject([{ external_id: 'match-2' }]);
		expect(JSON.parse(eventOneMatches.rows[0]!.player1_data as string)).toEqual({ name: 'Two Updated' });
		expect((await client.execute('select count(*) as count from player_round_standings where event_id = 1')).rows[0]!.count).toBe(1);
	});
});
