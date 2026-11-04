import type { H3Event } from 'h3';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { fakeOpCardBulkLookup, knownOpCard } from '~~/test/helpers/opCards';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// The Cards page lists, retries and resolves an OP Event's Unresolved Deck Cards through these routes.

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

vi.doMock('~~/server/db', () => ({ db }));
vi.doMock('~~/server/utils/ably', () => ({
	publishMessage: async () => {},
	publishMessageStrict: async () => {},
	publishScreenCommand: async () => {},
	getOriginConnectionId: () => undefined,
}));
vi.doMock('~~/server/modules/broadcast-graphics-live-session', async importOriginal => ({
	...await importOriginal<object>(),
	refreshBroadcastGraphicsBindings: async () => {},
}));
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
vi.doMock('~~/server/utils/bandaiKeepr', async importOriginal => ({
	...await importOriginal<object>(),
	lookUpOpCards: upstream.lookUpOpCards,
}));
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('getValidatedRouterParams', async (event: { params: unknown }, parse: (value: unknown) => unknown) => parse(event.params));
vi.stubGlobal('readValidatedBody', async (event: { body: unknown }, parse: (value: unknown) => unknown) => parse(event.body));
vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) => Object.assign(new Error(input.message), input));
vi.stubGlobal('useRuntimeConfig', () => ({ bandaiKeeprApiKey: 'test-key', bandaiKeeprApiUrl: 'https://op-api.test' }));

type Handler = (event: H3Event) => Promise<unknown>;
const list = (await import('~~/server/api/events/[id]/op-unresolved-deck-cards/index.get')).default as unknown as Handler;
const retry = (await import('~~/server/api/events/[id]/op-unresolved-deck-cards/[number]/retry.post')).default as unknown as Handler;
const resolve = (await import('~~/server/api/events/[id]/op-unresolved-deck-cards/[number]/index.put')).default as unknown as Handler;
const { opDeckListWriteModule } = await import('~~/server/modules/op-deck-list-write');

afterAll(async () => await harness.close());

describe('an OP Event\'s Unresolved Deck Cards, through their routes', () => {
	it('are listed, retried and resolved by card number', async () => {
		const [event] = await db.insert(schema.events)
			.values({ name: 'One Piece Regional', game: 'op', featureMatchOrientation: 'horizontal' })
			.returning();
		const [player] = await db.insert(schema.players).values({ eventId: event!.id, name: '', nickname: 'ana' }).returning();
		await opDeckListWriteModule().write({
			eventId: event!.id,
			owner: { kind: 'player', playerId: player!.id },
			input: { text: '1x OP01-016\n4x OP91-040' },
			source: 'hand',
		});
		const id = String(event!.id);

		expect(await list(stubH3Event({
			params: { id },
		}))).toMatchObject([
			{ number: 'OP91-040', copies: 4 },
		]);
		expect(await retry(stubH3Event({
			params: { id, number: 'op91-040' },
		}))).toEqual({ number: 'OP91-040', card: null, rewritten: 0 });
		expect(await resolve(stubH3Event({
			params: { id, number: 'op91-040' },
			body: { cardNumber: 'op01-040' },
		})))
			.toEqual({
				number: 'OP91-040',
				card: { number: 'OP01-040', name: 'Usopp' },
				rewritten: 1,
			});
		expect(await list(stubH3Event({
			params: { id },
		}))).toEqual([]);
	});
});
