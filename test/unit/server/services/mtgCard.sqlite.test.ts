import { drizzle } from 'drizzle-orm/d1';
import { afterAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// Card upserts over real SQL: one row per name whatever its case, fields a
// refresh leaves out survive it, and the JSON arrays it supplies replace.

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

vi.doMock('~~/server/db', () => ({ db }));

const { mtgCardService } = await import('~~/server/services/mtgCard');

afterAll(async () => await harness.close());

describe('mtgCardService.batchUpsert', () => {
	it('keeps fields a refresh leaves out and replaces the arrays it supplies', async () => {
		const token = (id: string) => ({ id, scryfallId: null, name: id, typeLine: null, uri: null });
		await mtgCardService().batchUpsert([{ name: 'Integration Bolt', game: 'mtg', scryfallId: 'keep-me', colors: 'R', deckCounterTypes: ['charge'], deckTokens: [token('old-token')] }]);

		const result = await mtgCardService().batchUpsert([{ name: 'Integration Bolt', game: 'mtg', colors: 'U', deckCounterTypes: ['energy'], deckTokens: [token('new-token')] }]);

		expect(result.get('integration bolt')).toMatchObject({
			scryfallId: 'keep-me',
			colors: 'U',
			deckCounterTypes: ['energy'],
			deckTokens: [expect.objectContaining({ id: 'new-token' })],
		});
	});

	it('stores one card per name, whatever its case, keyed by the lowercase name', async () => {
		const result = await mtgCardService().batchUpsert([
			{ name: 'Lightning Bolt', game: 'mtg' },
			{ name: 'LIGHTNING BOLT', game: 'mtg' },
		]);

		expect([...result.keys()]).toEqual(['lightning bolt']);
		expect((await db.select().from(schema.cards)).filter(card => card.name.toLowerCase() === 'lightning bolt')).toHaveLength(1);
	});

	it('upserts a thousand cards', async () => {
		const result = await mtgCardService().batchUpsert(Array.from({ length: 1000 }, (_, index) => ({ name: `Card ${index}`, game: 'mtg' as const, deckCounterTypes: [], deckTokens: [] })));

		expect(result.size).toBe(1000);
	});
});
