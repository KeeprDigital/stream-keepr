import type { OpCardSummary, OpCatalogueCard } from '~~/shared/types/card/op';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { knownOpCard } from '~~/test/helpers/opCards';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// A Deck List Screen showing a One Piece Card Game Player, or a Slot side a
// Player is linked into, reads that Player and their Deck List through the
// Screen: a capability reaches no other Player's.

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));
vi.doMock('~~/server/utils/screenOutputAuthorization', () => ({
	screenOutputReader: async () => 'capability',
}));

interface StubEvent { params: Record<string, string> }
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('getValidatedRouterParams', async (event: StubEvent, parse: (value: unknown) => unknown) => parse(event.params));
vi.stubGlobal('setResponseHeader', vi.fn());
vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

type Handler = (event: StubEvent) => Promise<unknown>;
const readDeckList = (await import('~~/server/api/screen-output/events/[id]/screens/[screenId]/players/[playerId]/deck-list.get')).default as unknown as Handler;
const { opPlayerDeckListService } = await import('~~/server/services/opPlayerDeckList');
const { opCardCatalogueService } = await import('~~/server/services/opCardCatalogue');

const ZORO = knownOpCard({
	number: 'OP01-001',
	name: 'Roronoa Zoro',
	category: 'leader',
	colors: ['Red'],
});
const SANJI = knownOpCard({
	number: 'OP01-013',
	name: 'Sanji',
	category: 'character',
	colors: ['Red'],
	cost: 2,
});

const ids = {
	event: 0,
	mtgEvent: 0,
	shown: 0,
	other: 0,
	empty: 0,
	mtgPlayer: 0,
	deckList: 0,
	screens: {} as Record<string, number>,
};

async function stageScreens(eventId: number, screens: Array<{ slug: string; mode: 'deck' | 'card'; playerId?: number; deckSource?: unknown }>) {
	const rows = await db.insert(schema.screens).values(screens.map(({ slug, mode, playerId, deckSource }) => ({
		eventId,
		name: slug,
		slug,
		currentMode: mode,
		modeConfigs: {
			deck: {
				deckSource: deckSource ?? { type: 'player', playerId },
			},
		} as never,
		assetCapabilitySeed: `seed-${slug}`,
		assetCapabilityDigest: `digest-${slug}`,
	}))).returning({ id: schema.screens.id, slug: schema.screens.slug });
	for (const row of rows)
		ids.screens[row.slug] = row.id;
}

beforeAll(async () => {
	const [event, mtgEvent] = await db.insert(schema.events).values([
		{ name: 'OP Event', game: 'op', featureMatchOrientation: 'horizontal' },
		{ name: 'MTG Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
	]).returning({ id: schema.events.id });
	ids.event = event!.id;
	ids.mtgEvent = mtgEvent!.id;
	const [shown, other, empty] = await db.insert(schema.players).values([
		{ eventId: ids.event, name: '', nickname: 'zoro_main' },
		{ eventId: ids.event, name: 'Bea' },
		{ eventId: ids.event, name: 'Cal' },
	]).returning({ id: schema.players.id });
	const [mtgPlayer] = await db.insert(schema.players).values({ eventId: ids.mtgEvent, name: 'Dee' }).returning({ id: schema.players.id });
	ids.shown = shown!.id;
	ids.other = other!.id;
	ids.empty = empty!.id;
	ids.mtgPlayer = mtgPlayer!.id;

	await opCardCatalogueService().add([ZORO, SANJI]);
	const catalogued = ({ name, category, colors, cost, power, counter, imageUrl }: OpCardSummary): OpCatalogueCard => ({
		name,
		category,
		colors: colors as OpCatalogueCard['colors'],
		cost,
		power,
		counter,
		imageUrl,
	});
	const view = (unknownNumber: string) => ({
		entries: [
			{
				number: 'OP01-001',
				quantity: 1,
				card: catalogued(ZORO),
			},
			{
				number: 'OP01-013',
				quantity: 4,
				card: catalogued(SANJI),
			},
			{ number: unknownNumber, quantity: 2, card: null },
		],
		leaderNumber: 'OP01-001',
		mainboardCount: 6,
		warnings: [],
	});
	for (const [playerId, unknownNumber] of [
		[ids.shown, 'OP99-001'],
		[ids.other, 'OP99-002'],
	] as const) {
		await opPlayerDeckListService().replace({
			eventId: ids.event,
			playerId,
			view: view(unknownNumber),
			archetypeId: null,
			handEdited: false,
		});
	}
	ids.deckList = (await opPlayerDeckListService().findByPlayer(ids.event, ids.shown))!.id;

	await stageScreens(ids.event, [
		{ slug: 'deck', mode: 'deck', playerId: ids.shown },
		{ slug: 'card', mode: 'card', playerId: ids.shown },
		{ slug: 'empty', mode: 'deck', playerId: ids.empty },
	]);
	// A Slot seating the shown Player and the one with no Deck List.
	const [slot] = await db.insert(schema.featureMatchSlots).values({ eventId: ids.event, player1Id: ids.shown, player2Id: ids.empty }).returning({ id: schema.featureMatchSlots.id });
	await stageScreens(ids.event, [
		{
			slug: 'slot',
			mode: 'deck',
			deckSource: { type: 'featureMatchSlot', slotId: slot!.id, side: 'player2' },
		},
	]);
	await stageScreens(ids.mtgEvent, [
		{ slug: 'mtg', mode: 'deck', playerId: ids.mtgPlayer },
	]);
});

afterAll(async () => await harness.close());

function params(screen: string, playerId: number, eventId = ids.event) {
	return {
		params: {
			id: String(eventId),
			screenId: String(ids.screens[screen]),
			playerId: String(playerId),
		},
	};
}

describe('a Deck List Screen showing a One Piece Card Game Player, read with its capability', () => {
	it('reads the Player it shows and their Deck List, Unresolved Deck Cards among it', async () => {
		await expect(readDeckList(params('deck', ids.shown))).resolves.toEqual({
			player: expect.objectContaining({ id: ids.shown, nickname: 'zoro_main' }),
			deckList: {
				id: ids.deckList,
				playerId: ids.shown,
				entries: [
					{
						number: 'OP01-001',
						quantity: 1,
						card: expect.objectContaining({ name: 'Roronoa Zoro', category: 'leader' }),
					},
					{
						number: 'OP01-013',
						quantity: 4,
						card: expect.objectContaining({ name: 'Sanji', cost: 2 }),
					},
					{ number: 'OP99-001', quantity: 2, card: null },
				],
				leaderNumber: 'OP01-001',
				mainboardCount: 6,
			},
		});
	});

	it('reads a Player linked into the Slot whose side it shows', async () => {
		await expect(readDeckList(params('slot', ids.shown))).resolves.toMatchObject({
			player: { id: ids.shown },
			deckList: { id: ids.deckList },
		});
	});

	it('answers a Player with no Deck List with none', async () => {
		await expect(readDeckList(params('empty', ids.empty))).resolves.toEqual({
			player: expect.objectContaining({ id: ids.empty }),
			deckList: null,
		});
	});

	it.each([
		{
			name: 'another Player\'s Deck List',
			screen: 'deck',
			playerId: () => ids.other,
			eventId: () => ids.event,
		},
		{
			name: 'its Player while the Screen shows another mode',
			screen: 'card',
			playerId: () => ids.shown,
			eventId: () => ids.event,
		},
		{
			name: 'a Player its Slot does not seat',
			screen: 'slot',
			playerId: () => ids.other,
			eventId: () => ids.event,
		},
		{
			name: 'a Magic: The Gathering Player',
			screen: 'mtg',
			playerId: () => ids.mtgPlayer,
			eventId: () => ids.mtgEvent,
		},
	])('reaches nothing else: $name', async ({ screen, playerId, eventId }) => {
		await expect(readDeckList(params(screen, playerId(), eventId()))).rejects.toMatchObject({ statusCode: 404, message: 'Not found' });
	});
});
