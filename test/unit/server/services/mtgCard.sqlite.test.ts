import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const client = createClient({ url: 'file::memory:' });
const sqliteDb = drizzle(client);

vi.doMock('hub:db', () => ({ db: sqliteDb }));

const { mtgCardService } = await import('~~/server/services/mtgCard');

describe('mtgCardService JSON bulk SQLite integration', () => {
	beforeAll(async () => {
		await client.execute(`
			create table cards (
				id integer primary key autoincrement,
				name text not null,
				game text not null default 'mtg',
				scryfall_id text,
				oracle_id text,
				card_type text,
				colors text,
				cmc real,
				mana_cost text,
				deck_counter_types text not null default '[]',
				deck_tokens text not null default '[]',
				created_at integer not null default (unixepoch() * 1000),
				updated_at integer not null default (unixepoch() * 1000),
				unique (name, game)
			)
		`);
	});

	afterAll(async () => await client.close());

	it('executes insert/conflict CTEs, preserves absent fields, and replaces supplied JSON arrays', async () => {
		const service = mtgCardService();
		await service.batchUpsert([{
			name: 'Integration Bolt',
			game: 'mtg',
			scryfallId: 'keep-me',
			colors: 'R',
			deckCounterTypes: ['charge'],
			deckTokens: [{
				id: 'old-token',
				scryfallId: null,
				name: 'Old Token',
				typeLine: null,
				uri: null,
			}],
		}]);

		const result = await service.batchUpsert([{
			name: 'Integration Bolt',
			game: 'mtg',
			colors: 'U',
			deckCounterTypes: ['energy'],
			deckTokens: [{
				id: 'new-token',
				scryfallId: 'new-token',
				name: 'New Token',
				typeLine: 'Token Creature',
				uri: null,
			}],
		}]);

		expect(result.get('integration bolt')).toMatchObject({
			scryfallId: 'keep-me',
			colors: 'U',
			deckCounterTypes: ['energy'],
			deckTokens: [expect.objectContaining({ id: 'new-token', name: 'New Token' })],
		});
	});
});
