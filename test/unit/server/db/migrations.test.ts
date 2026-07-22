import { readFileSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { describe, expect, it } from 'vitest';

type MigrationClient = ReturnType<typeof createClient>;

function migrationSql(filename: string): string {
	return readFileSync(new URL(`../../../../server/db/migrations/sqlite/${filename}`, import.meta.url), 'utf8');
}

async function executeStatements(client: MigrationClient, sql: string) {
	for (const statement of sql.split('--> statement-breakpoint').map(value => value.trim()).filter(Boolean))
		await client.execute(statement);
}

async function foreignKeyViolations(client: MigrationClient) {
	return (await client.execute('PRAGMA foreign_key_check')).rows;
}

describe('sqlite migrations', () => {
	it('preserves every legacy deck projection row when applying migration 0004', async () => {
		const client = createClient({ url: 'file::memory:' });

		try {
			await executeStatements(client, `
				PRAGMA foreign_keys = ON;--> statement-breakpoint
				CREATE TABLE events (id integer PRIMARY KEY);--> statement-breakpoint
				CREATE TABLE players (
					id integer PRIMARY KEY,
					event_id integer NOT NULL REFERENCES events(id) ON DELETE CASCADE
				);--> statement-breakpoint
				CREATE TABLE phases (
					id integer PRIMARY KEY,
					event_id integer NOT NULL REFERENCES events(id) ON DELETE CASCADE,
					name text NOT NULL,
					format_external_id text
				);--> statement-breakpoint
				CREATE TABLE cards (id integer PRIMARY KEY);--> statement-breakpoint
				CREATE TABLE player_deck_cards (
					id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
					player_id integer NOT NULL REFERENCES players(id) ON DELETE CASCADE,
					card_id integer NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
					phase_id integer NOT NULL,
					quantity integer NOT NULL,
					compartment text NOT NULL,
					sort_order integer NOT NULL
				);--> statement-breakpoint
				CREATE INDEX player_deck_cards_player_phase_idx ON player_deck_cards (player_id, phase_id);--> statement-breakpoint
				CREATE INDEX player_deck_cards_card_idx ON player_deck_cards (card_id);--> statement-breakpoint
				CREATE TABLE player_deck_companions (
					id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
					player_id integer NOT NULL REFERENCES players(id) ON DELETE CASCADE,
					phase_id integer NOT NULL,
					companion_card_id integer REFERENCES cards(id) ON DELETE SET NULL,
					source text NOT NULL,
					created_at integer NOT NULL,
					updated_at integer NOT NULL
				);--> statement-breakpoint
				CREATE UNIQUE INDEX player_deck_companions_player_phase_idx ON player_deck_companions (player_id, phase_id);--> statement-breakpoint
				CREATE INDEX player_deck_companions_card_idx ON player_deck_companions (companion_card_id);--> statement-breakpoint
				CREATE TABLE player_deck_unresolved_cards (
					id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
					event_id integer NOT NULL REFERENCES events(id) ON DELETE CASCADE,
					player_id integer NOT NULL REFERENCES players(id) ON DELETE CASCADE,
					phase_id integer NOT NULL,
					phase_name text,
					deck_name text NOT NULL,
					entry_type text NOT NULL,
					original_name text NOT NULL,
					normalized_original_name text NOT NULL,
					set_code text,
					normalized_set_code text DEFAULT '' NOT NULL,
					quantity integer DEFAULT 1 NOT NULL,
					compartment text,
					sort_order integer DEFAULT 0 NOT NULL,
					card_type text,
					created_at integer NOT NULL,
					updated_at integer NOT NULL
				);--> statement-breakpoint
				CREATE INDEX player_deck_unresolved_cards_event_idx ON player_deck_unresolved_cards (event_id);--> statement-breakpoint
				CREATE INDEX player_deck_unresolved_cards_player_phase_idx ON player_deck_unresolved_cards (player_id, phase_id);--> statement-breakpoint
				CREATE INDEX player_deck_unresolved_cards_lookup_idx ON player_deck_unresolved_cards (event_id, normalized_original_name, normalized_set_code);--> statement-breakpoint
				INSERT INTO events (id) VALUES (1);--> statement-breakpoint
				INSERT INTO players (id, event_id) VALUES (10, 1);--> statement-breakpoint
				INSERT INTO phases (id, event_id, name, format_external_id) VALUES (20, 1, 'Modern', 'modern');--> statement-breakpoint
				INSERT INTO cards (id) VALUES (30);--> statement-breakpoint
				INSERT INTO player_deck_cards (id, player_id, card_id, phase_id, quantity, compartment, sort_order)
				VALUES (40, 10, 30, 20, 4, 'mainboard', 0);--> statement-breakpoint
				INSERT INTO player_deck_companions (id, player_id, phase_id, companion_card_id, source, created_at, updated_at)
				VALUES (50, 10, 20, 30, 'imported', 100, 200);--> statement-breakpoint
				INSERT INTO player_deck_unresolved_cards (
					id, event_id, player_id, phase_id, phase_name, deck_name, entry_type,
					original_name, normalized_original_name, normalized_set_code, quantity,
					compartment, sort_order, created_at, updated_at
				) VALUES (60, 1, 10, 20, 'Modern', 'Legacy Burn', 'card', 'Mystery', 'mystery', '', 2, 'sideboard', 1, 100, 200);
			`);

			await executeStatements(client, migrationSql('0004_condemned_malice.sql'));

			const decks = await client.execute('SELECT * FROM player_decks');
			expect(decks.rows).toHaveLength(1);
			expect(decks.rows[0]).toMatchObject({
				event_id: 1,
				player_id: 10,
				external_id: 'legacy:10:20',
				external_source: 'melee',
				format_external_id: 'modern',
				name: 'Legacy Burn',
				is_primary: 1,
			});
			expect((await client.execute('SELECT id, quantity FROM player_deck_cards')).rows[0]).toMatchObject({ id: 40, quantity: 4 });
			expect((await client.execute('SELECT id, source FROM player_deck_companions')).rows[0]).toMatchObject({ id: 50, source: 'imported' });
			expect((await client.execute('SELECT id, original_name FROM player_deck_unresolved_cards')).rows[0]).toMatchObject({ id: 60, original_name: 'Mystery' });
			expect(await foreignKeyViolations(client)).toEqual([]);
		}
		finally {
			await client.close();
		}
	});

	it('corrects the archetype delete action without losing decks or child rows', async () => {
		const client = createClient({ url: 'file::memory:' });

		try {
			await executeStatements(client, `
				PRAGMA foreign_keys = ON;--> statement-breakpoint
				CREATE TABLE events (id integer PRIMARY KEY);--> statement-breakpoint
				CREATE TABLE players (id integer PRIMARY KEY, event_id integer NOT NULL REFERENCES events(id));--> statement-breakpoint
				CREATE TABLE archetypes (id integer PRIMARY KEY, event_id integer NOT NULL REFERENCES events(id));--> statement-breakpoint
				CREATE TABLE cards (id integer PRIMARY KEY);--> statement-breakpoint
				CREATE TABLE player_decks (
					id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
					event_id integer NOT NULL REFERENCES events(id) ON DELETE CASCADE,
					player_id integer NOT NULL REFERENCES players(id) ON DELETE CASCADE,
					external_id text NOT NULL,
					external_source text NOT NULL,
					format_external_id text NOT NULL,
					name text NOT NULL,
					colors text DEFAULT '' NOT NULL,
					sort_order integer DEFAULT 0 NOT NULL,
					is_primary integer DEFAULT false NOT NULL,
					created_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
					updated_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
					archetype_id integer REFERENCES archetypes(id),
					reviewed_at integer
				);--> statement-breakpoint
				CREATE INDEX player_decks_event_id_idx ON player_decks (event_id);--> statement-breakpoint
				CREATE INDEX player_decks_player_sort_idx ON player_decks (player_id, sort_order);--> statement-breakpoint
				CREATE INDEX player_decks_format_idx ON player_decks (event_id, format_external_id);--> statement-breakpoint
				CREATE INDEX player_decks_archetype_idx ON player_decks (archetype_id);--> statement-breakpoint
				CREATE UNIQUE INDEX player_decks_external_unique_idx ON player_decks (event_id, external_id, external_source);--> statement-breakpoint
				CREATE UNIQUE INDEX player_decks_primary_unique_idx ON player_decks (player_id) WHERE is_primary = 1;--> statement-breakpoint
				CREATE TABLE player_deck_cards (
					id integer PRIMARY KEY,
					deck_id integer NOT NULL REFERENCES player_decks(id) ON DELETE CASCADE,
					card_id integer NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
					quantity integer NOT NULL,
					compartment text NOT NULL,
					sort_order integer NOT NULL
				);--> statement-breakpoint
				CREATE TABLE player_deck_companions (
					id integer PRIMARY KEY,
					deck_id integer NOT NULL REFERENCES player_decks(id) ON DELETE CASCADE,
					companion_card_id integer REFERENCES cards(id) ON DELETE SET NULL,
					source text NOT NULL,
					created_at integer NOT NULL,
					updated_at integer NOT NULL
				);--> statement-breakpoint
				CREATE TABLE player_deck_unresolved_cards (
					id integer PRIMARY KEY,
					deck_id integer NOT NULL REFERENCES player_decks(id) ON DELETE CASCADE,
					entry_type text NOT NULL,
					original_name text NOT NULL,
					normalized_original_name text NOT NULL,
					set_code text,
					normalized_set_code text DEFAULT '' NOT NULL,
					quantity integer DEFAULT 1 NOT NULL,
					compartment text,
					sort_order integer DEFAULT 0 NOT NULL,
					card_type text,
					created_at integer NOT NULL,
					updated_at integer NOT NULL
				);--> statement-breakpoint
				INSERT INTO events VALUES (1);--> statement-breakpoint
				INSERT INTO players VALUES (10, 1);--> statement-breakpoint
				INSERT INTO archetypes VALUES (20, 1);--> statement-breakpoint
				INSERT INTO cards VALUES (30);--> statement-breakpoint
				INSERT INTO player_decks (id, event_id, player_id, external_id, external_source, format_external_id, name, archetype_id)
				VALUES (40, 1, 10, 'deck', 'melee', 'modern', 'Deck', 20);--> statement-breakpoint
				INSERT INTO player_deck_cards VALUES (50, 40, 30, 4, 'mainboard', 0);--> statement-breakpoint
				INSERT INTO player_deck_companions VALUES (60, 40, 30, 'imported', 100, 200);--> statement-breakpoint
				INSERT INTO player_deck_unresolved_cards VALUES (70, 40, 'card', 'Mystery', 'mystery', NULL, '', 1, NULL, 0, NULL, 100, 200);
			`);

			await executeStatements(client, migrationSql('0008_player_deck_archetype_fk.sql'));

			const foreignKeys = await client.execute('PRAGMA foreign_key_list(player_decks)');
			const archetypeForeignKey = foreignKeys.rows.find(row => row.table === 'archetypes');
			expect(archetypeForeignKey?.on_delete).toBe('SET NULL');
			expect((await client.execute('SELECT COUNT(*) AS count FROM player_deck_cards')).rows[0]?.count).toBe(1);
			expect((await client.execute('SELECT COUNT(*) AS count FROM player_deck_companions')).rows[0]?.count).toBe(1);
			expect((await client.execute('SELECT COUNT(*) AS count FROM player_deck_unresolved_cards')).rows[0]?.count).toBe(1);

			await client.execute('DELETE FROM archetypes WHERE id = 20');
			expect((await client.execute('SELECT archetype_id FROM player_decks WHERE id = 40')).rows[0]?.archetype_id).toBeNull();
			expect(await foreignKeyViolations(client)).toEqual([]);
		}
		finally {
			await client.close();
		}
	});

	it('adds strongly-consistent active Screen card state with a monotonic version', async () => {
		const client = createClient({ url: 'file::memory:' });

		try {
			await executeStatements(client, `
				CREATE TABLE screens (
					id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
					event_id integer NOT NULL,
					name text NOT NULL,
					slug text NOT NULL,
					current_mode text DEFAULT 'idle' NOT NULL,
					mode_configs text,
					screen_config text,
					state_version integer DEFAULT 0 NOT NULL,
					created_at integer NOT NULL,
					updated_at integer NOT NULL
				);--> statement-breakpoint
				INSERT INTO screens (id, event_id, name, slug, created_at, updated_at)
				VALUES (1, 1, 'Main', 'main', 100, 100);
			`);

			await executeStatements(client, migrationSql('0009_wise_rage.sql'));

			const columns = await client.execute('PRAGMA table_info(screens)');
			expect(columns.rows.find(row => row.name === 'active_card_version')).toMatchObject({
				notnull: 1,
				dflt_value: '0',
			});
			expect((await client.execute('SELECT active_card, active_card_version FROM screens WHERE id = 1')).rows[0]).toMatchObject({
				active_card: null,
				active_card_version: 0,
			});

			await client.execute({
				sql: 'UPDATE screens SET active_card = ?, active_card_version = active_card_version + 1 WHERE id = 1',
				args: [JSON.stringify({ id: 'card-1' })],
			});
			expect((await client.execute('SELECT active_card_version FROM screens WHERE id = 1')).rows[0]?.active_card_version).toBe(1);
		}
		finally {
			await client.close();
		}
	});
});
