import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const client = createClient({ url: 'file::memory:' });
const sqliteDb = drizzle(client);

vi.doMock('~~/server/db', () => ({ db: sqliteDb }));

const { playerDeckService } = await import('~~/server/services/playerDeck');

describe('playerDeckService JSON bulk SQLite integration', () => {
	beforeAll(async () => {
		for (const statement of [
			`create table players (
				id integer primary key autoincrement, event_id integer not null, name text not null,
				pronouns text, external_id text, external_source text, external_status integer,
				is_active integer not null default 1, last_seen_at integer, wins integer, losses integer,
				draws integer, position integer, points integer, archetype_id integer, lgs text,
				game_data text, created_at integer not null default (unixepoch() * 1000),
				updated_at integer not null default (unixepoch() * 1000)
			)`,
			`create table archetypes (
				id integer primary key autoincrement, event_id integer not null, name text not null,
				colors text, created_at integer not null default (unixepoch() * 1000),
				updated_at integer not null default (unixepoch() * 1000)
			)`,
			`create table player_decks (
				id integer primary key autoincrement, event_id integer not null, player_id integer not null,
				external_id text not null, external_source text not null, format_external_id text not null,
				name text not null, colors text not null default '', sort_order integer not null default 0,
				is_primary integer not null default 0, archetype_id integer, reviewed_at integer,
				created_at integer not null default (unixepoch() * 1000),
				updated_at integer not null default (unixepoch() * 1000),
				unique (event_id, external_id, external_source)
			)`,
			`create unique index player_decks_primary_unique_idx on player_decks(player_id) where is_primary = 1`,
			`create table player_deck_cards (
				id integer primary key autoincrement, deck_id integer not null, card_id integer not null,
				quantity integer not null, compartment text not null, sort_order integer not null
			)`,
			`create table player_deck_companions (
				id integer primary key autoincrement, deck_id integer not null unique, companion_card_id integer,
				source text not null, created_at integer not null default (unixepoch() * 1000),
				updated_at integer not null default (unixepoch() * 1000)
			)`,
			`create table player_deck_unresolved_cards (
				id integer primary key autoincrement, deck_id integer not null, entry_type text not null,
				original_name text not null, normalized_original_name text not null, set_code text,
				normalized_set_code text not null default '', quantity integer not null default 1,
				compartment text, sort_order integer not null default 0, card_type text,
				created_at integer not null default (unixepoch() * 1000),
				updated_at integer not null default (unixepoch() * 1000)
			)`,
		]) {
			await client.execute(statement);
		}
		await client.execute({
			sql: 'insert into players (event_id, name, game_data) values (?, ?, ?)',
			args: [1, 'Deck Player', JSON.stringify({ type: 'mtg', deckName: 'Old', deckColors: 'R', customField: 'keep' })],
		});
	});

	afterAll(async () => await client.close());

	it('persists a complete deck snapshot, then clears only deck projection fields for an empty snapshot', async () => {
		const service = playerDeckService();
		await service.replaceMeleeDecksForEvent(1, [{ playerId: 1, snapshots: [{
			deck: {
				eventId: 1,
				playerId: 1,
				externalId: 'deck-1',
				formatExternalId: 'modern',
				name: 'Bulk Deck',
				colors: 'UG',
				sortOrder: 0,
				isPrimary: true,
			},
			cards: [{ cardId: 7, quantity: 4, compartment: 'mainboard', sortOrder: 0 }],
			unresolvedCards: [{
				entryType: 'card',
				originalName: 'Mystery',
				normalizedOriginalName: 'mystery',
				setCode: null,
				normalizedSetCode: '',
				quantity: 1,
				compartment: 'sideboard',
				sortOrder: 1,
				cardType: null,
			}],
			importedCompanion: { action: 'set', cardId: 7 },
		}] }]);

		const deck = await client.execute('select name, colors, is_primary from player_decks');
		const playerAfterInsert = await client.execute('select game_data from players where id = 1');
		expect(deck.rows[0]).toMatchObject({ name: 'Bulk Deck', colors: 'UG', is_primary: 1 });
		expect(JSON.parse(String(playerAfterInsert.rows[0]!.game_data))).toMatchObject({
			deckName: 'Bulk Deck',
			deckColors: 'UG',
			customField: 'keep',
		});
		expect((await client.execute('select count(*) as count from player_deck_cards')).rows[0]!.count).toBe(1);
		expect((await client.execute('select count(*) as count from player_deck_unresolved_cards')).rows[0]!.count).toBe(1);
		expect((await client.execute('select count(*) as count from player_deck_companions')).rows[0]!.count).toBe(1);

		await service.replaceMeleeDecksForEvent(1, [{ playerId: 1, snapshots: [] }]);

		const playerAfterClear = await client.execute('select archetype_id, game_data from players where id = 1');
		expect((await client.execute('select count(*) as count from player_decks')).rows[0]!.count).toBe(0);
		expect(playerAfterClear.rows[0]!.archetype_id).toBeNull();
		expect(JSON.parse(String(playerAfterClear.rows[0]!.game_data))).toEqual({
			type: 'mtg',
			deckName: null,
			deckColors: null,
			customField: 'keep',
		});
	});

	it('preserves an unchanged deck review but clears it when the submitted contents change', async () => {
		const playerResult = await client.execute({
			sql: 'insert into players (event_id, name, game_data) values (?, ?, ?)',
			args: [1, 'Reviewed Player', JSON.stringify({ type: 'mtg', deckName: null, deckColors: null })],
		});
		const archetypeResult = await client.execute({
			sql: 'insert into archetypes (event_id, name, colors) values (?, ?, ?)',
			args: [1, 'Control', 'WU'],
		});
		const playerId = Number(playerResult.lastInsertRowid);
		const archetypeId = Number(archetypeResult.lastInsertRowid);
		const service = playerDeckService();
		const replacement = (quantity: number, sortOrder = 0, companionCardId?: number) => [{ playerId, snapshots: [{
			deck: {
				eventId: 1,
				playerId,
				externalId: 'reviewed-deck',
				formatExternalId: 'modern',
				name: 'Imported Control',
				colors: 'WU',
				sortOrder: 0,
				isPrimary: true,
			},
			cards: [{ cardId: 7, quantity, compartment: 'mainboard' as const, sortOrder }],
			unresolvedCards: [],
			importedCompanion: companionCardId == null
				? { action: 'clear' as const }
				: { action: 'set' as const, cardId: companionCardId },
		}] }];

		await service.replaceMeleeDecksForEvent(1, replacement(4, 9));
		const [deck] = await service.listByPlayer(1, playerId);
		expect(deck).toBeDefined();
		await service.reviewDeck(1, playerId, deck!.id, archetypeId);

		await service.replaceMeleeDecksForEvent(1, replacement(4));
		const [unchangedDeck] = await service.listByPlayer(1, playerId);
		expect(unchangedDeck).toMatchObject({ archetypeId, reviewedAt: expect.any(Date) });

		await service.replaceMeleeDecksForEvent(1, replacement(3));
		const [changedDeck] = await service.listByPlayer(1, playerId);
		const changedPlayer = await client.execute({
			sql: 'select archetype_id, game_data from players where id = ?',
			args: [playerId],
		});
		expect(changedDeck).toMatchObject({ archetypeId: null, reviewedAt: null });
		expect(changedPlayer.rows[0]!.archetype_id).toBeNull();
		expect(JSON.parse(String(changedPlayer.rows[0]!.game_data))).toMatchObject({
			deckName: 'Imported Control',
			deckColors: 'WU',
		});

		await service.reviewDeck(1, playerId, changedDeck!.id, archetypeId);
		await service.replaceMeleeDecksForEvent(1, replacement(3, 0, 8));
		const [deckWithNewCompanion] = await service.listByPlayer(1, playerId);
		expect(deckWithNewCompanion).toMatchObject({ archetypeId: null, reviewedAt: null });

		await service.reviewDeck(1, playerId, deckWithNewCompanion!.id, archetypeId);
		await service.replaceMeleeDecksForEvent(1, replacement(3, 4, 8));
		const [deckWithUnchangedCompanion] = await service.listByPlayer(1, playerId);
		expect(deckWithUnchangedCompanion).toMatchObject({ archetypeId, reviewedAt: expect.any(Date) });
	});
});
