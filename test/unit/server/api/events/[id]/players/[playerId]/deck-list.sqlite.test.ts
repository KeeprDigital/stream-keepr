import type { H3Event } from 'h3';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { fakeOpCardBulkLookup, knownOpCard, mockOpWriteBoundaries } from '~~/test/helpers/opCards';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// The Players page's Deck List editor saves through the OP Deck List write, as a hand edit.

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

const upstream = fakeOpCardBulkLookup([
	knownOpCard({
		number: 'OP01-016',
		name: 'Nami',
		category: 'leader',
		colors: ['Blue'],
	}),
	knownOpCard({
		number: 'OP01-040',
		name: 'Usopp',
		category: 'character',
		colors: ['Blue'],
	}),
]);
mockOpWriteBoundaries(db, () => upstream);
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('getValidatedRouterParams', async (event: { params: unknown }, parse: (value: unknown) => unknown) => parse(event.params));
vi.stubGlobal('readValidatedBody', async (event: { body: unknown }, parse: (value: unknown) => unknown) => parse(event.body));
vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) => Object.assign(new Error(input.message), input));
vi.stubGlobal('useRuntimeConfig', () => ({ bandaiKeeprApiKey: 'test-key', bandaiKeeprApiUrl: 'https://op-api.test' }));

type Handler = (event: H3Event) => Promise<unknown>;
const put = (await import('~~/server/api/events/[id]/players/[playerId]/deck-list.put')).default as unknown as Handler;
const get = (await import('~~/server/api/events/[id]/players/[playerId]/deck-list.get')).default as unknown as Handler;

afterAll(async () => await harness.close());

describe('a Player\'s Deck List, through its route', () => {
	it('is saved as a hand edit with the Leader picked, and read back', async () => {
		const [event] = await db.insert(schema.events)
			.values({ name: 'One Piece Regional', game: 'op', featureMatchOrientation: 'horizontal' })
			.returning();
		const [player] = await db.insert(schema.players).values({ eventId: event!.id, name: '', nickname: 'ana' }).returning();
		const params = {
			id: String(event!.id),
			playerId: String(player!.id),
		};

		const saved = await put(stubH3Event({
			params,
			body: { text: '4x OP01-040', leaderNumber: 'op01-016' },
		}));

		expect(saved).toMatchObject({
			deckList: { leaderNumber: 'OP01-016', mainboardCount: 4, handEdited: true },
			player: {
				id: player!.id,
				archetypeId: expect.any(Number),
			},
		});
		expect(await get(stubH3Event({ params }))).toEqual({ deckList: (saved as { deckList: unknown }).deckList });
	});
});
