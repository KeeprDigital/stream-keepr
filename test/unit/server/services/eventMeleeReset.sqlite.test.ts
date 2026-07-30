import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';

const client = createClient({ url: 'file::memory:' });
const sqliteDb = drizzle(client, { schema });
const protectMeleeClientSecret = vi.fn(async (secret: string) => `encrypted:${secret}`);

vi.doMock('hub:db', () => ({ db: sqliteDb }));
vi.doMock('~~/server/services/meleeCredentials', () => ({ protectMeleeClientSecret }));

const { eventService } = await import('~~/server/services/event');

async function firstRow(sql: string) {
	return (await client.execute(sql)).rows[0]!;
}

async function rowCount(table: string, where = ''): Promise<number> {
	const result = await firstRow(`select count(*) as count from ${table} ${where}`);
	return Number(result.count);
}

describe('eventService Melee config reset SQLite integration', () => {
	beforeAll(async () => {
		for (const statement of [
			`create table events (
				id integer primary key autoincrement, name text not null, game text not null,
				feature_match_orientation text not null, melee_enabled integer not null default 0,
				melee_event_id text, melee_client_id text, melee_client_secret text,
				initial_setup_completed_at integer, last_event_synced_at integer,
				last_players_synced_at integer, last_decklists_synced_at integer, last_sync_error text,
				melee_sync_lease_token text, melee_sync_lease_command text, melee_sync_lease_expires_at integer,
				feature_match_default_best_of integer not null default 3,
				feature_match_default_starting_life integer not null default 20,
				feature_match_default_clock_type text not null default 'countdown',
				feature_match_default_clock_duration integer not null default 50,
				feature_match_default_count_up_after_countdown integer not null default 0,
				feature_match_default_turn_tracking_enabled integer not null default 0,
				feature_match_default_active_player_tracking_enabled integer not null default 0,
				feature_match_default_extra_turns_enabled integer not null default 0,
				feature_match_default_extra_turns integer not null default 5,
				feature_match_default_extra_turns_label text not null default 'Extra Turns',
				feature_match_default_mulligan_tracking_enabled integer not null default 0,
				created_at integer not null default (unixepoch() * 1000),
				updated_at integer not null default (unixepoch() * 1000)
			)`,
			`create table event_card_name_overrides (
				id integer primary key autoincrement, event_id integer not null
			)`,
			`create table matches (
				id integer primary key autoincrement, event_id integer not null, external_source text
			)`,
			`create table phases (
				id integer primary key autoincrement, event_id integer not null, external_source text
			)`,
			`create table players (
				id integer primary key autoincrement, event_id integer not null, external_source text
			)`,
			`create table feature_match_slots (
				id integer primary key autoincrement, event_id integer not null, match_id integer,
				external_id text, external_source text, table_number integer, round_name text, format_name text,
				player1_id integer, player2_id integer, player1_data text, player2_data text,
				best_of integer not null default 3, sort_order integer not null default 0,
				player_display_mode text not null default 'score', active_session_id integer,
				created_at integer not null default (unixepoch() * 1000),
				updated_at integer not null default (unixepoch() * 1000)
			)`,
			`create table feature_match_sessions (
				id integer primary key autoincrement, event_id integer not null, slot_id integer not null,
				status text not null default 'active', source_snapshot text not null, current_state text not null,
				sequence integer not null default 0, closed_at integer,
				created_at integer not null default (unixepoch() * 1000),
				updated_at integer not null default (unixepoch() * 1000)
			)`,
			`create unique index feature_match_sessions_active_slot_idx
				on feature_match_sessions(slot_id) where status = 'active'`,
			`create table live_state_command_receipts (
				id integer primary key autoincrement, event_id integer not null,
				aggregate_kind text not null, aggregate_id integer not null,
				command_id text not null, command_type text not null, content_key text not null,
				sequence integer not null,
				created_at integer not null default (unixepoch() * 1000),
				unique (aggregate_kind, aggregate_id, command_id)
			)`,
		]) {
			await client.execute(statement);
		}

		await client.execute(`insert into events (
			id, name, game, feature_match_orientation, melee_enabled, melee_event_id,
			melee_client_id, melee_client_secret, initial_setup_completed_at, last_event_synced_at,
			last_players_synced_at, last_decklists_synced_at, last_sync_error,
			melee_sync_lease_token, melee_sync_lease_command, melee_sync_lease_expires_at
		) values (
			1, 'Atomic Event', 'mtg', 'horizontal', 1, 'old-event',
			'old-client', 'encrypted:old-secret', 101, 102, 103, 104, 'old-error',
			'lease-token', 'update', 9999999999999
		)`);
		await client.execute(`insert into event_card_name_overrides (event_id) values (1)`);
		await client.execute(`insert into matches (id, event_id, external_source) values
			(11, 1, 'melee'), (12, 1, 'manual')`);
		await client.execute(`insert into phases (event_id, external_source) values
			(1, 'melee'), (1, 'manual')`);
		await client.execute(`insert into players (id, event_id, external_source) values
			(21, 1, 'melee'), (22, 1, 'manual')`);
		await client.execute({
			sql: `insert into feature_match_slots (
				id, event_id, match_id, external_id, external_source, table_number, round_name,
				format_name, player1_id, player2_id, player1_data, player2_data, best_of,
				sort_order, player_display_mode, active_session_id
			) values (10, 1, 11, 'melee-match', 'melee', 7, 'Round 3', 'modern', 21, 22, ?, ?, 5, 4, 'score', 100)`,
			args: [JSON.stringify({ name: 'Player One' }), JSON.stringify({ name: 'Player Two' })],
		});
		await client.execute({
			sql: `insert into feature_match_sessions (
				id, event_id, slot_id, status, source_snapshot, current_state, sequence
			) values (100, 1, 10, 'active', ?, ?, 7)`,
			args: [JSON.stringify({ old: 'snapshot' }), JSON.stringify({ old: 'state' })],
		});
		await client.execute(`insert into live_state_command_receipts (
			event_id, aggregate_kind, aggregate_id, command_id, command_type, content_key, sequence
		) values (1, 'featureMatchSession', 100, 'old-command', 'SnapshotCorrected', 'old-content-key', 7)`);
	});

	afterAll(async () => await client.close());

	it('rolls back imported data, feature state, and Event config when a later statement fails', async () => {
		await client.execute(`create trigger reject_replacement_session_event
			before delete on live_state_command_receipts
			begin
				select raise(abort, 'forced reset failure');
			end`);

		const input = {
			meleeEnabled: true,
			meleeEventId: 'new-event',
			meleeClientId: 'new-client',
			meleeClientSecret: 'new-secret',
		};
		await expect(eventService().updateMeleeConfig(1, input)).rejects.toThrow(/forced reset failure/);

		const eventAfterFailure = await firstRow(`select * from events where id = 1`);
		expect(eventAfterFailure).toMatchObject({
			melee_enabled: 1,
			melee_event_id: 'old-event',
			melee_client_id: 'old-client',
			melee_client_secret: 'encrypted:old-secret',
			initial_setup_completed_at: 101,
			last_event_synced_at: 102,
			last_players_synced_at: 103,
			last_decklists_synced_at: 104,
			last_sync_error: 'old-error',
			melee_sync_lease_token: 'lease-token',
			melee_sync_lease_command: 'update',
			melee_sync_lease_expires_at: 9999999999999,
		});
		expect(await rowCount('event_card_name_overrides', 'where event_id = 1')).toBe(1);
		expect(await rowCount('matches', `where event_id = 1 and external_source = 'melee'`)).toBe(1);
		expect(await rowCount('phases', `where event_id = 1 and external_source = 'melee'`)).toBe(1);
		expect(await rowCount('players', `where event_id = 1 and external_source = 'melee'`)).toBe(1);

		const slotAfterFailure = await firstRow(`select * from feature_match_slots where id = 10`);
		expect(slotAfterFailure).toMatchObject({
			match_id: 11,
			external_id: 'melee-match',
			external_source: 'melee',
			table_number: 7,
			round_name: 'Round 3',
			format_name: 'modern',
			player1_id: 21,
			player2_id: 22,
			active_session_id: 100,
		});
		expect(await rowCount('feature_match_sessions')).toBe(1);
		expect(await firstRow(`select status, sequence from feature_match_sessions where id = 100`))
			.toMatchObject({ status: 'active', sequence: 7 });
		expect(await rowCount('live_state_command_receipts')).toBe(1);

		await client.execute(`drop trigger reject_replacement_session_event`);
		await expect(eventService().updateMeleeConfig(1, input)).resolves.toBe(true);

		const eventAfterSuccess = await firstRow(`select * from events where id = 1`);
		expect(eventAfterSuccess).toMatchObject({
			melee_enabled: 1,
			melee_event_id: 'new-event',
			melee_client_id: 'new-client',
			melee_client_secret: 'encrypted:new-secret',
			initial_setup_completed_at: null,
			last_event_synced_at: null,
			last_players_synced_at: null,
			last_decklists_synced_at: null,
			last_sync_error: null,
			melee_sync_lease_token: 'lease-token',
			melee_sync_lease_command: 'update',
			melee_sync_lease_expires_at: 9999999999999,
		});
		expect(await rowCount('event_card_name_overrides', 'where event_id = 1')).toBe(0);
		expect(await rowCount('matches', `where event_id = 1 and external_source = 'melee'`)).toBe(0);
		expect(await rowCount('phases', `where event_id = 1 and external_source = 'melee'`)).toBe(0);
		expect(await rowCount('players', `where event_id = 1 and external_source = 'melee'`)).toBe(0);
		expect(await rowCount('matches', `where event_id = 1 and external_source = 'manual'`)).toBe(1);
		expect(await rowCount('phases', `where event_id = 1 and external_source = 'manual'`)).toBe(1);
		expect(await rowCount('players', `where event_id = 1 and external_source = 'manual'`)).toBe(1);

		const slotAfterSuccess = await firstRow(`select * from feature_match_slots where id = 10`);
		expect(slotAfterSuccess).toMatchObject({
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
			best_of: 5,
			sort_order: 4,
			player_display_mode: 'score',
		});
		expect(slotAfterSuccess.active_session_id).not.toBe(100);
		expect(await firstRow(`select status, sequence, closed_at from feature_match_sessions where id = 100`))
			.toMatchObject({ status: 'closed', sequence: 7, closed_at: expect.any(Number) });

		const newSession = await firstRow(`select * from feature_match_sessions where id = ${Number(slotAfterSuccess.active_session_id)}`);
		expect(newSession).toMatchObject({ status: 'active', sequence: 1, slot_id: 10, event_id: 1 });
		expect(JSON.parse(String(newSession.source_snapshot))).toMatchObject({
			eventId: 1,
			slotId: 10,
			matchId: null,
			externalId: null,
			externalSource: null,
			formatName: null,
			bestOf: 5,
			player1: { playerId: null, data: null },
			player2: { playerId: null, data: null },
		});
		// The replaced Session's receipts go with it: a closed Session accepts no
		// further command, so nothing is left to deduplicate against.
		expect(await rowCount('live_state_command_receipts')).toBe(0);
		expect(protectMeleeClientSecret).toHaveBeenCalledWith('new-secret');
	});
});
