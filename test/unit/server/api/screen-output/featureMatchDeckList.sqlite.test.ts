import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// A Deck List Screen showing a Feature Match Slot side reads that Slot, and its Deck
// Lists, through the Screen: a capability reaches nothing else (ADR-0022).

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
const readDeckList = (await import('~~/server/api/screen-output/events/[id]/screens/[screenId]/feature-match-slots/[slotId]/deck-lists/[deckListId].get')).default as unknown as Handler;
const readSlot = (await import('~~/server/api/screen-output/events/[id]/screens/[screenId]/feature-match-slots/[slotId].get')).default as unknown as Handler;
const { featureMatchDeckListService } = await import('~~/server/services/featureMatchDeckList');

let eventId: number;
let shownSlotId: number;
let otherSlotId: number;
let shownDeckListId: number;
let otherDeckListId: number;
const screenIds: Record<string, number> = {};

const ENTRIES = [
	{
		number: 'OP01-001',
		quantity: 1,
		card: {
			name: 'Roronoa Zoro',
			category: 'leader' as const,
			colors: ['Red' as const],
			cost: null,
			power: 5000,
			counter: null,
			imageUrl: 'https://cards-img.keepr.digital/OP01-001.png',
		},
	},
	{
		number: 'OP01-013',
		quantity: 4,
		card: {
			name: 'Sanji',
			category: 'character' as const,
			colors: ['Red' as const],
			cost: 2,
			power: 4000,
			counter: 1000,
			imageUrl: 'https://cards-img.keepr.digital/OP01-013.png',
		},
	},
];

beforeAll(async () => {
	const [event] = await db.insert(schema.events).values({ name: 'OP Event', game: 'op', featureMatchOrientation: 'horizontal' }).returning({ id: schema.events.id });
	eventId = event!.id;
	const [shown, other] = await db.insert(schema.featureMatchSlots).values([
		{ eventId },
		{ eventId, sortOrder: 1 },
	]).returning({ id: schema.featureMatchSlots.id });
	shownSlotId = shown!.id;
	otherSlotId = other!.id;
	const view = {
		entries: ENTRIES,
		leaderNumber: 'OP01-001',
		mainboardCount: 4,
		warnings: [],
	};
	shownDeckListId = await featureMatchDeckListService().create(eventId, shownSlotId, '1 OP01-001\n4 OP01-013', view);
	otherDeckListId = await featureMatchDeckListService().create(eventId, otherSlotId, '1 OP01-001\n4 OP01-013', view);

	const screens = await db.insert(schema.screens).values([
		['deck', 'deck'],
		['card', 'background'],
	].map(([slug, currentMode], index) => ({
		eventId,
		name: slug!,
		slug: slug!,
		currentMode: currentMode as 'deck',
		modeConfigs: {
			deck: {
				deckSource: { type: 'featureMatchSlot', slotId: shownSlotId, side: 'player1' },
			},
		} as never,
		assetCapabilitySeed: `seed-${index}`,
		assetCapabilityDigest: `digest-${index}`,
	}))).returning({ id: schema.screens.id, slug: schema.screens.slug });
	for (const screen of screens)
		screenIds[screen.slug] = screen.id;
});

afterAll(async () => await harness.close());

function params(screen: string, slotId: number, deckListId?: number) {
	return {
		params: {
			id: String(eventId),
			screenId: String(screenIds[screen]),
			slotId: String(slotId),
			...(deckListId === undefined
				? {}
				: {
						deckListId: String(deckListId),
					}),
		},
	};
}

describe('a Deck List Screen showing a Feature Match Slot side, read with its capability', () => {
	it('reads the Slot it shows, and a Deck List of that Slot', async () => {
		await expect(readSlot(params('deck', shownSlotId))).resolves.toMatchObject({
			slot: { id: shownSlotId },
		});
		await expect(readDeckList(params('deck', shownSlotId, shownDeckListId))).resolves.toEqual({
			id: shownDeckListId,
			slotId: shownSlotId,
			entries: ENTRIES,
			leaderNumber: 'OP01-001',
			mainboardCount: 4,
		});
	});

	it.each([
		{
			name: 'another Slot\'s Deck List',
			screen: 'deck',
			slot: () => otherSlotId,
			deckList: () => otherDeckListId,
		},
		{
			name: 'another Slot\'s Deck List under its own Slot',
			screen: 'deck',
			slot: () => shownSlotId,
			deckList: () => otherDeckListId,
		},
		{
			name: 'its Deck List while the Screen shows another mode',
			screen: 'card',
			slot: () => shownSlotId,
			deckList: () => shownDeckListId,
		},
	])('reaches nothing else: $name', async ({ screen, slot, deckList }) => {
		await expect(readDeckList(params(screen, slot(), deckList()))).rejects.toMatchObject({ statusCode: 404, message: 'Not found' });
	});
});
