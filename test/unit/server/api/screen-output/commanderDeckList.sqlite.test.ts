import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { deckListEntryOf, MOXFIELD_CARDS } from '~~/test/helpers/magicDeckText';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// A Deck List Screen showing a Commander Seat reads that Seat's Deck List
// through the Screen, as it reads its Slot (ADR-0022, ADR-0087).

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
const readDeckList = (await import('~~/server/api/screen-output/events/[id]/screens/[screenId]/feature-match-slots/[slotId]/commander-deck-lists/[deckListId].get')).default as unknown as Handler;
const { featureMatchDeckListService } = await import('~~/server/services/featureMatchDeckList');

const ENTRIES = [
	deckListEntryOf(MOXFIELD_CARDS.ashling),
	deckListEntryOf(MOXFIELD_CARDS.forest, 3),
];
let eventId: number;
let screenId: number;
let shownSlotId: number;
let otherSlotId: number;
let shownDeckListId: number;
let otherDeckListId: number;

beforeAll(async () => {
	const [event] = await db.insert(schema.events).values({
		name: 'Commander Event',
		game: 'mtg',
		variant: 'commander',
		featureMatchOrientation: 'horizontal',
	}).returning({ id: schema.events.id });
	eventId = event!.id;
	const [shown, other] = await db.insert(schema.featureMatchSlots).values([
		{ eventId },
		{ eventId, sortOrder: 1 },
	]).returning({ id: schema.featureMatchSlots.id });
	shownSlotId = shown!.id;
	otherSlotId = other!.id;
	shownDeckListId = await featureMatchDeckListService().createCommander(eventId, shownSlotId, 'shown', ENTRIES, 3);
	otherDeckListId = await featureMatchDeckListService().createCommander(eventId, otherSlotId, 'other', ENTRIES, 3);
	const [screen] = await db.insert(schema.screens).values({
		eventId,
		name: 'Deck',
		slug: 'deck',
		currentMode: 'deck',
		modeConfigs: {
			deck: {
				deckSource: { type: 'featureMatchSlot', slotId: shownSlotId, side: 'player4' },
			},
		} as never,
		assetCapabilitySeed: 'seed',
		assetCapabilityDigest: 'digest',
	}).returning({ id: schema.screens.id });
	screenId = screen!.id;
});

afterAll(async () => await harness.close());

function params(slotId: number, deckListId: number) {
	return {
		params: {
			id: String(eventId),
			screenId: String(screenId),
			slotId: String(slotId),
			deckListId: String(deckListId),
		},
	};
}

describe('a Deck List Screen showing a Commander Seat, read with its capability', () => {
	it('reads a Deck List of the Slot it shows, each card the printing it was saved as', async () => {
		await expect(readDeckList(params(shownSlotId, shownDeckListId))).resolves.toEqual({
			id: shownDeckListId,
			slotId: shownSlotId,
			entries: ENTRIES,
		});
	});

	it('reaches no Deck List of another Slot, under its own Slot or the one shown', async () => {
		await expect(readDeckList(params(otherSlotId, otherDeckListId))).rejects.toMatchObject({ statusCode: 404 });
		await expect(readDeckList(params(shownSlotId, otherDeckListId))).rejects.toMatchObject({ statusCode: 404 });
	});
});
