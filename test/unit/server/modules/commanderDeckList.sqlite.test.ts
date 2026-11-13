import type { Seat } from '~~/shared/types/enums';
import type { Commander } from '~~/shared/types/game';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { ATRAXA, typedSeat } from '~~/test/helpers/commanders';
import { ARENA_COPY, MOXFIELD_CARDS, MOXFIELD_COPY, MTGO_COPY } from '~~/test/helpers/magicDeckText';
import { fakeOpCardBulkLookup, mockOpWriteBoundaries } from '~~/test/helpers/opCards';
import { createScryfallFake } from '~~/test/helpers/scryfallFake';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// A Commander Seat's Feature Match Deck List (ADR-0087): a pasted Moxfield copy, each card
// the printing its line names, saved with the Commanders its operator confirmed.
// Scryfall is faked at the network; the Slot, its Session and the list are real SQL.

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));
vi.stubGlobal('useRuntimeConfig', () => ({ bandaiKeeprApiKey: '', bandaiKeeprApiUrl: '' }));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
mockOpWriteBoundaries(db, () => fakeOpCardBulkLookup([]));

const { commanderDeckListModule } = await import('~~/server/modules/feature-match-deck-list');
const { featureMatchSlotWriteModule } = await import('~~/server/modules/feature-match-slot-write');
const { featureMatchService } = await import('~~/server/services/featureMatch');
const { featureMatchStateService } = await import('~~/server/services/featureMatchState');

const { ashling, animar, forest, graveshifter } = MOXFIELD_CARDS;
const ASHLING: Commander = {
	scryfallId: ashling.id,
	name: 'Ashling, the Limitless',
	colorIdentity: 'WUBRG',
	setCode: 'ecc',
	collectorNumber: '1',
};
const ANIMAR: Commander = {
	scryfallId: animar.id,
	name: 'Animar, Soul of Elements',
	colorIdentity: 'URG',
	setCode: '2x2',
	collectorNumber: '171',
};

let scryfall = createScryfallFake(Object.values(MOXFIELD_CARDS));

beforeEach(() => {
	scryfall = createScryfallFake(Object.values(MOXFIELD_CARDS));
	vi.stubGlobal('fetch', (...args: Parameters<typeof scryfall.fetch>) => scryfall.fetch(...args));
});

afterAll(async () => {
	await harness.close();
});

async function stageSlot(event: { game: 'mtg' | 'op'; variant: 'commander' | 'two-player' | null } = { game: 'mtg', variant: 'commander' }) {
	const [created] = await db.insert(schema.events)
		.values({ name: 'Event', featureMatchOrientation: 'horizontal', ...event })
		.returning({ id: schema.events.id });
	const eventId = created!.id;
	const slot = await featureMatchService().create(eventId, {});
	await featureMatchStateService().createSessionForSlot(slot.id, eventId);
	return { eventId, slotId: slot.id };
}

async function slotRow(slotId: number) {
	return (await db.query.featureMatches.findFirst({ where: eq(schema.featureMatches.id, slotId) }))!;
}

async function storedLists(slotId: number) {
	return await db.select({ id: schema.featureMatchDeckLists.id })
		.from(schema.featureMatchDeckLists)
		.where(eq(schema.featureMatchDeckLists.slotId, slotId));
}

function mtg(data: { gameData?: unknown } | null | undefined) {
	return data?.gameData as { commanders?: Commander[]; featureMatchDeckList?: { id: number; mainboardCount: number } | null; deckName?: string } | undefined;
}

/** Pastes `text` to a Seat with the Commanders it offers, as an operator confirming the preview does. */
async function pasteOffered(eventId: number, slotId: number, seat: Seat, text: string) {
	const preview = await commanderDeckListModule().preview({ eventId, text });
	if (!preview.ok)
		throw new Error(`Refused: ${JSON.stringify(preview.errors)}`);
	const saved = await commanderDeckListModule().save({
		eventId,
		slotId,
		seat,
		text,
		commanders: preview.deckList.offeredCommanders,
	});
	return { preview: preview.deckList, ...saved };
}

describe('a Commander Seat\'s Feature Match Deck List', () => {
	it.each([
		{ copy: 'Moxfield\'s own copy', text: MOXFIELD_COPY, kept: 9 },
		{ copy: 'the Arena copy', text: ARENA_COPY, kept: 2 },
		{ copy: 'the MTGO and plain-text copy', text: MTGO_COPY, kept: 5 },
	])('saves $copy with Ashling offered as the Commander and the Sideboard dropped', async ({ text, kept }) => {
		const { eventId, slotId } = await stageSlot();

		const { preview, deckList, featureMatch } = await pasteOffered(eventId, slotId, 'player3', text);

		expect(preview.sideboardDropped).toBe(1);
		expect(preview.offeredCommanders).toEqual([ashling.id]);
		expect(deckList.entries.reduce((total, entry) => total + entry.quantity, 0)).toBe(kept);
		expect(deckList.entries.map(entry => entry.name)).not.toContain('Arbor Elf');
		expect(mtg(featureMatch.player3Data)).toMatchObject({
			commanders: [ASHLING],
			deckName: 'Ashling, the Limitless',
			featureMatchDeckList: { id: deckList.id, mainboardCount: kept - 1 },
		});
	});

	it('stores each card as the printing its line names, the foil-marked line included, and reads them back', async () => {
		const { eventId, slotId } = await stageSlot();

		const { deckList } = await pasteOffered(eventId, slotId, 'player1', MOXFIELD_COPY);

		const read = await commanderDeckListModule().read({ eventId, slotId, deckListId: deckList.id });
		expect(read.sourceText).toBe(MOXFIELD_COPY);
		expect(read.entries.map(entry => [entry.quantity, entry.name, entry.setCode, entry.collectorNumber, entry.scryfallId])).toEqual([
			[1, 'Ashling, the Limitless', 'ecc', '1', ashling.id],
			[1, 'Animar, Soul of Elements', '2x2', '171', animar.id],
			[1, 'Eirdu, Carrier of Dawn // Isilu, Carrier of Twilight', 'ecl', '13', MOXFIELD_CARDS.eirdu.id],
			[1, 'Garruk\'s Uprising', 'plst', 'M21-186', MOXFIELD_CARDS.garruksUprising.id],
			[1, 'Graveshifter', 'ecl', '104', graveshifter.id],
			[1, 'Hedge Maze', 'pmkm', '262p', MOXFIELD_CARDS.hedgeMaze.id],
			[3, 'Forest', 'kld', '264', forest.id],
		]);
		expect(read.entries[0]).toMatchObject({ colorIdentity: 'WUBRG', cardType: 'Legendary Creature — Elemental Sorcerer' });
	});

	// A Moxfield paste is about a hundred exact printings: one request, not one each.
	it('asks Scryfall for a paste\'s printings in one request', async () => {
		const { eventId } = await stageSlot();

		await commanderDeckListModule().preview({ eventId, text: MOXFIELD_COPY });

		expect(scryfall.collectionBatches).toHaveLength(1);
		expect(scryfall.namedLookups).toEqual([]);
	});

	it.each([
		{
			choice: 'the Commander changed to another card of the list',
			commanders: [animar.id],
			held: [ANIMAR],
			deckName: 'Animar, Soul of Elements',
			mainboardCount: 8,
		},
		{
			choice: 'a second Commander added from the list',
			commanders: [ashling.id, animar.id],
			held: [ASHLING, ANIMAR],
			deckName: 'Ashling, the Limitless / Animar, Soul of Elements',
			mainboardCount: 7,
		},
	])('saves $choice', async ({ commanders, held, deckName, mainboardCount }) => {
		const { eventId, slotId } = await stageSlot();

		const { featureMatch } = await commanderDeckListModule().save({ eventId, slotId, seat: 'player2', text: MOXFIELD_COPY, commanders });

		expect(mtg(featureMatch.player2Data)).toMatchObject({
			commanders: held,
			deckName,
			featureMatchDeckList: { mainboardCount },
		});
	});

	it('replaces the Commanders picked by search, keeps what else the Seat holds, and reaches the active Session', async () => {
		const { eventId, slotId } = await stageSlot();
		await featureMatchSlotWriteModule().updateSetup({
			eventId,
			slotId,
			input: { player1Data: typedSeat('Ana', [ATRAXA], { pronouns: 'she/her' }) },
		});

		const { deckList } = await pasteOffered(eventId, slotId, 'player1', MOXFIELD_COPY);

		const slot = await slotRow(slotId);
		expect(slot.player1Data).toMatchObject({ name: 'Ana', pronouns: 'she/her' });
		expect(mtg(slot.player1Data)?.commanders).toEqual([ASHLING]);
		const session = (await db.query.featureMatchSessions.findFirst({
			where: eq(schema.featureMatchSessions.id, slot.activeSessionId!),
		}))!;
		expect(mtg(session.sourceSnapshot.player1.data)).toMatchObject({
			commanders: [ASHLING],
			featureMatchDeckList: { id: deckList.id },
		});
	});

	it('replaces the list a Seat held, deleting the old one', async () => {
		const { eventId, slotId } = await stageSlot();
		await pasteOffered(eventId, slotId, 'player1', MOXFIELD_COPY);

		const { deckList } = await pasteOffered(eventId, slotId, 'player1', ARENA_COPY);

		expect(await storedLists(slotId)).toEqual([{ id: deckList.id }]);
		expect(mtg((await slotRow(slotId)).player1Data)?.featureMatchDeckList).toEqual({ id: deckList.id, mainboardCount: 1 });
	});

	it.each([
		{
			refusal: 'a line naming a printing that does not exist',
			text: '1 Ashling, the Limitless (ECC) 1\n1 Graveshifter (ECL) 9999',
			commanders: [ashling.id],
			error: { code: 'INVALID_PRINTING_HINT', lineNumber: 2, sourceText: '1 Graveshifter (ECL) 9999' },
		},
		{
			refusal: 'a card nothing resolves',
			text: '1 Ashling, the Limitless (ECC) 1\n1 Not A Card',
			commanders: [ashling.id],
			error: { code: 'UNRESOLVED_CARD', lineNumber: 2, sourceText: '1 Not A Card' },
		},
		{
			refusal: 'a paste with no Commander confirmed',
			text: MOXFIELD_COPY,
			commanders: [],
			error: { code: 'NO_COMMANDER' },
		},
		{
			refusal: 'a Commander that is not a card of the list',
			text: MOXFIELD_COPY,
			commanders: [ATRAXA.scryfallId],
			error: { code: 'COMMANDER_NOT_IN_LIST' },
		},
	])('refuses $refusal, and saves nothing', async ({ text, commanders, error }) => {
		const { eventId, slotId } = await stageSlot();

		const refused = await commanderDeckListModule().save({ eventId, slotId, seat: 'player1', text, commanders }).catch(error => error);

		expect(refused).toMatchObject({
			statusCode: 422,
			data: { code: 'COMMANDER_DECK_LIST_INVALID', errors: [expect.objectContaining(error)] },
		});
		expect(await storedLists(slotId)).toEqual([]);
		expect((await slotRow(slotId)).player1Data).toBeNull();
	});

	it('previews a refusal with the line at fault, and stores nothing for a preview', async () => {
		const { eventId, slotId } = await stageSlot();

		const refused = await commanderDeckListModule().preview({ eventId, text: '1 Ashling, the Limitless (ECC) 1\n1 Graveshifter (ECL) 9999' });
		const accepted = await commanderDeckListModule().preview({ eventId, text: MOXFIELD_COPY });

		expect(refused).toEqual({
			ok: false,
			errors: [expect.objectContaining({ code: 'INVALID_PRINTING_HINT', lineNumber: 2 })],
		});
		expect(accepted.ok).toBe(true);
		expect(await storedLists(slotId)).toEqual([]);
	});

	it('answers a Scryfall outage as one to retry, and saves nothing', async () => {
		const { eventId, slotId } = await stageSlot();
		vi.useFakeTimers();
		vi.stubGlobal('fetch', async () => new Response('down', { status: 503 }));

		try {
			const save = commanderDeckListModule()
				.save({ eventId, slotId, seat: 'player1', text: MOXFIELD_COPY, commanders: [ashling.id] })
				.catch(error => error);
			await vi.runAllTimersAsync();

			expect((await save).cause).toMatchObject({ code: 'BROADCAST_DECK_LIST_CARD_PROVIDER_UNAVAILABLE', retryable: true });
		}
		finally {
			vi.useRealTimers();
		}
		expect(await storedLists(slotId)).toEqual([]);
	});

	it.each([
		{ event: 'a Two-Player Magic: The Gathering Event', game: 'mtg', variant: 'two-player' },
		{ event: 'a One Piece Card Game Event', game: 'op', variant: null },
	] as const)('is refused on $event', async ({ game, variant }) => {
		const { eventId, slotId } = await stageSlot({ game, variant });

		await expect(commanderDeckListModule().preview({ eventId, text: MOXFIELD_COPY })).rejects.toMatchObject({ statusCode: 400 });
		await expect(commanderDeckListModule().save({ eventId, slotId, seat: 'player1', text: MOXFIELD_COPY, commanders: [ashling.id] }))
			.rejects
			.toMatchObject({ statusCode: 400 });
		expect(await storedLists(slotId)).toEqual([]);
	});
});

describe('a Commander Slot\'s setup save, for a Seat holding a Deck List', () => {
	async function pastedSlot() {
		const staged = await stageSlot();
		const { deckList } = await pasteOffered(staged.eventId, staged.slotId, 'player1', MOXFIELD_COPY);
		return { ...staged, deckListId: deckList.id };
	}

	it.each([
		{
			save: 'keeps the list when the save names none',
			gameData: { type: 'mtg' as const, commanders: [ASHLING] },
			reference: { mainboardCount: 8 },
		},
		{
			save: 'counts the Mainboard again when a second Commander is picked from the list',
			gameData: { type: 'mtg' as const, commanders: [ASHLING, ANIMAR] },
			reference: { mainboardCount: 7 },
		},
		{
			save: 'keeps the list it holds when the save names a Deck List that is not this Slot\'s',
			gameData: { type: 'mtg' as const, commanders: [ASHLING], featureMatchDeckList: { id: 999_999, mainboardCount: 60 } },
			reference: { mainboardCount: 8 },
		},
	])('$save', async ({ gameData, reference }) => {
		const { eventId, slotId, deckListId } = await pastedSlot();

		const saved = await featureMatchSlotWriteModule().updateSetup({
			eventId,
			slotId,
			input: { player1Data: { name: 'Ana', gameData } },
		});

		expect(mtg(saved.player1Data)?.featureMatchDeckList).toEqual({ id: deckListId, ...reference });
		expect(await storedLists(slotId)).toEqual([{ id: deckListId }]);
	});

	it.each([
		{
			save: 'cleared from the Seat, which keeps its Commanders',
			player1Data: { name: 'Ana', gameData: { type: 'mtg' as const, commanders: [ASHLING], featureMatchDeckList: null } },
			commanders: [ASHLING],
		},
		{
			save: 'left on a Seat that was emptied',
			player1Data: null,
			commanders: undefined,
		},
	])('deletes a list $save', async ({ player1Data, commanders }) => {
		const { eventId, slotId } = await pastedSlot();

		const saved = await featureMatchSlotWriteModule().updateSetup({ eventId, slotId, input: { player1Data } });

		expect(mtg(saved.player1Data)?.commanders).toEqual(commanders);
		expect(mtg(saved.player1Data)?.featureMatchDeckList ?? null).toBeNull();
		expect(await storedLists(slotId)).toEqual([]);
	});

	it('moves a list with its player when two Seats are swapped', async () => {
		const { eventId, slotId, deckListId } = await pastedSlot();

		const swapped = await featureMatchSlotWriteModule().swapSeats({ eventId, slotId, seats: ['player1', 'player4'] });

		expect(mtg(swapped.player4Data)?.featureMatchDeckList).toEqual({ id: deckListId, mainboardCount: 8 });
		expect(swapped.player1Data ?? null).toBeNull();
		expect(await storedLists(slotId)).toEqual([{ id: deckListId }]);
	});

	it('refuses a Seat\'s Deck List on a Two-Player Event', async () => {
		const { eventId, slotId } = await stageSlot({ game: 'mtg', variant: 'two-player' });

		await expect(featureMatchSlotWriteModule().updateSetup({
			eventId,
			slotId,
			input: { player1Data: { name: 'Ana', gameData: { type: 'mtg', featureMatchDeckList: { id: 1, mainboardCount: 60 } } } },
		})).rejects.toMatchObject({ statusCode: 400 });
	});

	it('takes no Deck List from the write that creates a Slot', async () => {
		const { eventId, deckListId } = await pastedSlot();

		const created = await featureMatchSlotWriteModule().create({
			eventId,
			input: { player1Data: { name: 'Ben', gameData: { type: 'mtg', commanders: [ANIMAR], featureMatchDeckList: { id: deckListId, mainboardCount: 8 } } } },
		});

		expect(mtg(created.player1Data)).toMatchObject({ commanders: [ANIMAR] });
		expect(mtg(created.player1Data)?.featureMatchDeckList).toBeUndefined();
	});
});
