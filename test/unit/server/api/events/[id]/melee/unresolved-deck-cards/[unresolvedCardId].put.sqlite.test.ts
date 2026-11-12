import type { H3Event } from 'h3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { eventRealtimeChannel } from '~~/shared/utils/realtimeChannels';
import { createAblyRestFake } from '~~/test/helpers/ablyRestFake';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// PUT /api/events/:id/melee/unresolved-deck-cards/:unresolvedCardId over real SQL: the
// route resolves the Unresolved Deck Card its path names as the card its body names, for
// the request it answers. Scryfall and Ably are faked; `deckListResolution.sqlite.test.ts` owns the resolution.

interface StubRequest {
	params: Record<string, string>;
	body: unknown;
	headers: Record<string, string>;
	responseHeaders: Record<string, unknown>;
}
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('getValidatedRouterParams', async (event: StubRequest, parse: (value: unknown) => unknown) => parse(event.params));
vi.stubGlobal('readValidatedBody', async (event: StubRequest, parse: (value: unknown) => unknown) => parse(event.body));
vi.stubGlobal('getHeader', (event: StubRequest, name: string) => event.headers[name]);
vi.stubGlobal('setResponseHeader', (event: Partial<StubRequest>, name: string, value: unknown) => {
	(event.responseHeaders ??= {})[name] = value;
});
vi.stubGlobal('createError', (input: { statusCode?: number; message?: string; statusMessage?: string; cause?: unknown }) =>
	Object.assign(new Error(input.message ?? input.statusMessage ?? 'error'), input));
vi.stubGlobal('useRuntimeConfig', () => ({ ablyApiKey: 'test-key' }));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));

const ably = createAblyRestFake();
vi.doMock('ably', () => ably.module);

const BOLT_ID = '3b1e5f6a-9d2c-4e8f-b7a1-0c5d4e3f2a1b';
/** The card provider: each id it was asked for, and whether it is down. */
const scryfall = { asked: [] as string[], down: false };
vi.doMock('~~/server/utils/scryfall', () => ({
	fetchScryfallCardById: async (id: string) => {
		scryfall.asked.push(id);
		if (scryfall.down)
			throw Object.assign(new Error('private upstream response body'), { code: 'SCRYFALL_UPSTREAM_FAILURE', notFound: false });
		return {
			id,
			name: 'Lightning Bolt',
			oracleId: 'oracle-bolt',
			typeLine: 'Instant',
			colors: 'R',
			cmc: 1,
			manaCost: '{R}',
			deckCounterTypes: [],
			deckTokens: [],
		};
	},
}));

type Handler = (event: H3Event) => Promise<Record<string, unknown>>;
const putResolution = (await import('~~/server/api/events/[id]/melee/unresolved-deck-cards/[unresolvedCardId].put')).default as unknown as Handler;

/** An MTG Event whose one Player's Deck List holds one Unresolved Deck Card. */
async function stageUnresolvedDeckCard() {
	const [event] = await db.insert(schema.events)
		.values({ name: 'Resolution Open', game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	const eventId = event!.id;
	const [player] = await db.insert(schema.players).values({ eventId, name: 'Player' }).returning({ id: schema.players.id });
	const [deck] = await db.insert(schema.playerDecks).values({
		eventId,
		playerId: player!.id,
		externalId: `deck-${eventId}`,
		externalSource: 'melee',
		formatExternalId: 'modern',
		name: 'Deck',
		isPrimary: true,
	}).returning({ id: schema.playerDecks.id });
	const [entry] = await db.insert(schema.playerDeckUnresolvedCards).values({
		deckId: deck!.id,
		entryType: 'card',
		originalName: 'Lightnng Bolt',
		normalizedOriginalName: 'lightnng bolt',
		setCode: 'M11',
		normalizedSetCode: 'm11',
		quantity: 4,
		compartment: 'mainboard',
		sortOrder: 2,
	}).returning({ id: schema.playerDeckUnresolvedCards.id });
	return {
		eventId,
		playerId: player!.id,
		deckId: deck!.id,
		entryId: entry!.id,
	};
}

function request(params: Record<string, string>, body: unknown): StubRequest {
	return {
		params,
		body,
		headers: { 'x-realtime-connection-id': 'origin-1' },
		responseHeaders: {},
	};
}

async function deckCards(deckId: number) {
	return await db.select({ name: schema.cards.name, quantity: schema.playerDeckCards.quantity })
		.from(schema.playerDeckCards)
		.innerJoin(schema.cards, eq(schema.cards.id, schema.playerDeckCards.cardId))
		.where(eq(schema.playerDeckCards.deckId, deckId));
}

async function unresolvedIn(deckId: number) {
	return await db.select().from(schema.playerDeckUnresolvedCards).where(eq(schema.playerDeckUnresolvedCards.deckId, deckId));
}

beforeEach(() => {
	ably.reset();
	scryfall.asked.length = 0;
	scryfall.down = false;
});
afterAll(async () => await harness.close());

describe('resolving an Unresolved Deck Card through its route', () => {
	it('resolves the entry its path names as the card its body names, announcing under the writer\'s origin', async () => {
		const { eventId, playerId, deckId, entryId } = await stageUnresolvedDeckCard();

		const answer = await putResolution(stubH3Event({
			...request({
				id: String(eventId),
				unresolvedCardId: String(entryId),
			}, { scryfallId: BOLT_ID }),
		}));

		expect(answer).toMatchObject({ success: true, unresolvedId: entryId, resolvedCount: 1 });
		expect(scryfall.asked).toEqual([BOLT_ID]);
		expect(await deckCards(deckId)).toEqual([
			{ name: 'Lightning Bolt', quantity: 4 },
		]);
		expect(await unresolvedIn(deckId)).toEqual([]);
		expect(ably.on(eventRealtimeChannel(eventId))).toEqual([
			expect.objectContaining({
				type: 'playerDeck:cardsResolved',
				payload: {
					deckIds: [deckId],
					playerIds: [playerId],
					originConnectionId: 'origin-1',
				},
			}),
		]);
	});

	// "Temporarily unavailable" owes its caller an interval, set on the request being answered.
	it('tells the request it is answering when to retry, when the card provider is down', async () => {
		const { eventId, deckId, entryId } = await stageUnresolvedDeckCard();
		scryfall.down = true;
		const asked = request({
			id: String(eventId),
			unresolvedCardId: String(entryId),
		}, { scryfallId: BOLT_ID });

		await expect(putResolution(stubH3Event({ ...asked }))).rejects.toMatchObject({
			cause: { code: 'SCRYFALL_UPSTREAM_FAILURE' },
		});

		expect(asked.responseHeaders).toEqual({ 'retry-after': 5 });
		expect(await unresolvedIn(deckId)).toHaveLength(1);
	});

	it.each<[string, (entryId: number) => Record<string, string>, unknown]>([
		[
			'a card id that is not positive',
			() => ({ unresolvedCardId: '0' }),
			{ scryfallId: BOLT_ID },
		],
		[
			'a scryfallId that is not a UUID',
			entryId => ({
				unresolvedCardId: String(entryId),
			}),
			{ scryfallId: 'not-a-uuid' },
		],
	])('refuses %s before the card provider is asked, resolving nothing', async (_case, params, body) => {
		const { eventId, deckId, entryId } = await stageUnresolvedDeckCard();

		await expect(putResolution(stubH3Event({
			...request({
				id: String(eventId),
				...params(entryId),
			}, body),
		}))).rejects.toMatchObject({ name: 'ZodError' });

		expect(scryfall.asked).toEqual([]);
		expect(await unresolvedIn(deckId)).toHaveLength(1);
		expect(ably.published).toEqual([]);
	});
});
