import type { ManualPlayerSlotData } from '~~/shared/api';
import type { Seat } from '~~/shared/types/enums';
import type { Commander } from '~~/shared/types/game';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { ATRAXA, typedSeat } from '~~/test/helpers/commanders';
import { ANIMAR, ARENA_COPY, ASHLING, MOXFIELD_CARDS, MOXFIELD_COPY } from '~~/test/helpers/magicDeckText';
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

beforeEach(() => {
	vi.stubGlobal('fetch', createScryfallFake(Object.values(MOXFIELD_CARDS)).fetch);
});

afterAll(async () => {
	await harness.close();
});

async function stageSlot(variant: 'commander' | 'two-player' = 'commander') {
	const [created] = await db.insert(schema.events)
		.values({
			name: 'Event',
			featureMatchOrientation: 'horizontal',
			game: 'mtg',
			variant,
		})
		.returning({ id: schema.events.id });
	const eventId = created!.id;
	const slot = await featureMatchService().create(eventId, {});
	await featureMatchStateService().createSessionForSlot(slot.id, eventId);
	return { eventId, slotId: slot.id };
}

async function slotRow(slotId: number) {
	return (await db.query.featureMatches.findFirst({
		where: eq(schema.featureMatches.id, slotId),
	}))!;
}

async function storedLists(slotId: number) {
	return await db.select({ id: schema.featureMatchDeckLists.id })
		.from(schema.featureMatchDeckLists)
		.where(eq(schema.featureMatchDeckLists.slotId, slotId));
}

/** A Seat's game data as a Commander Slot holds it. */
function held(data: { gameData?: unknown } | null | undefined) {
	return data?.gameData as {
		commanders?: Commander[];
		featureMatchDeckList?: { id: number; mainboardCount: number } | null;
		deckName?: string;
	} | undefined;
}

/** Pastes `text` to a Seat with the Commanders it offers, as an operator confirming the preview does. */
async function pasteOffered(eventId: number, slotId: number, seat: Seat, text = MOXFIELD_COPY) {
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
	it('saves a Moxfield copy with the offered Commander, each card the printing its line names, and the Sideboard dropped', async () => {
		const { eventId, slotId } = await stageSlot();

		const { preview, deckList, featureMatch } = await pasteOffered(eventId, slotId, 'player3');

		expect(preview).toMatchObject({
			offeredCommanders: [ashling.id],
			sideboardDropped: 1,
		});
		expect(held(featureMatch.player3Data)).toMatchObject({
			commanders: [ASHLING],
			deckName: 'Ashling, the Limitless',
			featureMatchDeckList: { id: deckList.id, mainboardCount: 8 },
		});
		const read = await commanderDeckListModule().read({ eventId, slotId, deckListId: deckList.id });
		expect(read.sourceText).toBe(MOXFIELD_COPY);
		expect(read.entries.map(entry => [
			entry.quantity,
			entry.name,
			entry.setCode,
			entry.collectorNumber,
			entry.scryfallId,
		])).toEqual([
			[
				1,
				'Ashling, the Limitless',
				'ecc',
				'1',
				ashling.id,
			],
			[
				1,
				'Animar, Soul of Elements',
				'2x2',
				'171',
				animar.id,
			],
			[
				1,
				'Eirdu, Carrier of Dawn // Isilu, Carrier of Twilight',
				'ecl',
				'13',
				MOXFIELD_CARDS.eirdu.id,
			],
			[
				1,
				'Garruk\'s Uprising',
				'plst',
				'M21-186',
				MOXFIELD_CARDS.garruksUprising.id,
			],
			[
				1,
				'Graveshifter',
				'ecl',
				'104',
				graveshifter.id,
			],
			[
				1,
				'Hedge Maze',
				'pmkm',
				'262p',
				MOXFIELD_CARDS.hedgeMaze.id,
			],
			[3, 'Forest', 'kld', '264', forest.id],
		]);
		expect(read.entries[0]).toMatchObject({ colorIdentity: 'WUBRG', cardType: 'Legendary Creature — Elemental Sorcerer' });
	});

	it.each([
		{
			choice: 'the Commander changed to another card of the list',
			commanders: [animar.id],
			seated: [ANIMAR],
			deckName: 'Animar, Soul of Elements',
			mainboardCount: 8,
		},
		{
			choice: 'a second Commander added from the list',
			commanders: [ashling.id, animar.id],
			seated: [ASHLING, ANIMAR],
			deckName: 'Ashling, the Limitless / Animar, Soul of Elements',
			mainboardCount: 7,
		},
	])('saves $choice', async ({ commanders, seated, deckName, mainboardCount }) => {
		const { eventId, slotId } = await stageSlot();

		const { featureMatch } = await commanderDeckListModule().save({
			eventId,
			slotId,
			seat: 'player2',
			text: MOXFIELD_COPY,
			commanders,
		});

		expect(held(featureMatch.player2Data)).toMatchObject({
			commanders: seated,
			deckName,
			featureMatchDeckList: { mainboardCount },
		});
	});

	it('replaces the Commanders picked by search, keeps the Seat\'s player, and reaches the active Session', async () => {
		const { eventId, slotId } = await stageSlot();
		await featureMatchSlotWriteModule().updateSetup({
			eventId,
			slotId,
			input: {
				player1Data: typedSeat('Ana', [ATRAXA], { pronouns: 'she/her' }),
			},
		});

		const { deckList } = await pasteOffered(eventId, slotId, 'player1');

		const slot = await slotRow(slotId);
		expect(slot.player1Data).toMatchObject({ name: 'Ana', pronouns: 'she/her' });
		expect(held(slot.player1Data)?.commanders).toEqual([ASHLING]);
		const session = (await db.query.featureMatchSessions.findFirst({
			where: eq(schema.featureMatchSessions.id, slot.activeSessionId!),
		}))!;
		expect(held(session.sourceSnapshot.player1.data)).toMatchObject({
			commanders: [ASHLING],
			featureMatchDeckList: { id: deckList.id },
		});
	});

	it('replaces the list a Seat held, deleting the old one', async () => {
		const { eventId, slotId } = await stageSlot();
		await pasteOffered(eventId, slotId, 'player1');

		const { deckList } = await pasteOffered(eventId, slotId, 'player1', ARENA_COPY);

		expect(await storedLists(slotId)).toEqual([
			{ id: deckList.id },
		]);
		expect(held((await slotRow(slotId)).player1Data)?.featureMatchDeckList).toEqual({ id: deckList.id, mainboardCount: 1 });
	});

	it.each([
		{
			refusal: 'a paste the parser refuses, with the line at fault',
			text: '1 Ashling, the Limitless (ECC) 1\n1 Graveshifter (ECL) 9999',
			commanders: [ashling.id],
			error: { code: 'INVALID_PRINTING_HINT', lineNumber: 2, sourceText: '1 Graveshifter (ECL) 9999' },
		},
		{
			refusal: 'a paste with no Commander confirmed',
			text: MOXFIELD_COPY,
			commanders: [],
			error: { code: 'NO_COMMANDER_CONFIRMED' },
		},
		{
			refusal: 'a Commander that is not a card of the list',
			text: MOXFIELD_COPY,
			commanders: [ATRAXA.scryfallId],
			error: { code: 'COMMANDER_NOT_IN_LIST' },
		},
	])('refuses $refusal, and saves nothing', async ({ text, commanders, error }) => {
		const { eventId, slotId } = await stageSlot();

		const refused = await commanderDeckListModule().save({
			eventId,
			slotId,
			seat: 'player1',
			text,
			commanders,
		}).catch(error => error);

		expect(refused).toMatchObject({
			statusCode: 422,
			data: {
				code: 'COMMANDER_DECK_LIST_INVALID',
				errors: [
					expect.objectContaining(error),
				],
			},
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
			errors: [
				expect.objectContaining({ code: 'INVALID_PRINTING_HINT', lineNumber: 2 }),
			],
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
				.save({
					eventId,
					slotId,
					seat: 'player1',
					text: MOXFIELD_COPY,
					commanders: [ashling.id],
				})
				.catch(error => error);
			await vi.runAllTimersAsync();

			expect((await save).cause).toMatchObject({ code: 'BROADCAST_DECK_LIST_CARD_PROVIDER_UNAVAILABLE', retryable: true });
		}
		finally {
			vi.useRealTimers();
		}
		expect(await storedLists(slotId)).toEqual([]);
	});

	it('is refused on an Event that is not a Commander Event', async () => {
		const { eventId, slotId } = await stageSlot('two-player');

		await expect(commanderDeckListModule().preview({ eventId, text: MOXFIELD_COPY })).rejects.toMatchObject({ statusCode: 400 });
		await expect(commanderDeckListModule().save({
			eventId,
			slotId,
			seat: 'player1',
			text: MOXFIELD_COPY,
			commanders: [ashling.id],
		})).rejects.toMatchObject({ statusCode: 400 });
		expect(await storedLists(slotId)).toEqual([]);
	});
});

describe('a Commander Slot\'s setup save, for a Seat holding a Deck List', () => {
	async function pastedSlot() {
		const staged = await stageSlot();
		const { deckList } = await pasteOffered(staged.eventId, staged.slotId, 'player1');
		return { ...staged, deckListId: deckList.id };
	}

	const seatHolding = (commanders: Commander[], reference?: { id: number; mainboardCount: number } | null): ManualPlayerSlotData => ({
		name: 'Ana',
		gameData: {
			type: 'mtg',
			commanders,
			...(reference === undefined
				? {}
				: { featureMatchDeckList: reference }),
		},
	});

	it.each([
		{
			save: 'keeps the list when the save names none',
			commanders: [ASHLING],
			mainboardCount: 8,
		},
		{
			save: 'counts the Mainboard again when a second Commander is picked from the list',
			commanders: [ASHLING, ANIMAR],
			mainboardCount: 7,
		},
	])('$save', async ({ commanders, mainboardCount }) => {
		const { eventId, slotId, deckListId } = await pastedSlot();

		const saved = await featureMatchSlotWriteModule().updateSetup({
			eventId,
			slotId,
			input: {
				player1Data: seatHolding(commanders),
			},
		});

		expect(held(saved.player1Data)?.featureMatchDeckList).toEqual({ id: deckListId, mainboardCount });
		expect(await storedLists(slotId)).toEqual([
			{ id: deckListId },
		]);
	});

	// While a list is held its Commanders are its cards: a stale form's searched pick must not land beside it.
	it.each([
		{
			refusal: 'a Commander that is not a card of the list',
			commanders: [ATRAXA],
		},
		{ refusal: 'no Commander at all', commanders: [] },
	])('refuses a save leaving the Seat\'s list with $refusal, and keeps the Seat as it was', async ({ commanders }) => {
		const { eventId, slotId, deckListId } = await pastedSlot();

		await expect(featureMatchSlotWriteModule().updateSetup({
			eventId,
			slotId,
			input: {
				player1Data: seatHolding(commanders),
			},
		})).rejects.toMatchObject({ statusCode: 409 });

		expect(held((await slotRow(slotId)).player1Data)).toMatchObject({
			commanders: [ASHLING],
			featureMatchDeckList: { id: deckListId, mainboardCount: 8 },
		});
	});

	it.each([
		{
			save: 'cleared from the Seat, which keeps its Commanders and may search for others',
			player1Data: seatHolding([ASHLING, ATRAXA], null),
			commanders: [ASHLING, ATRAXA],
		},
		{
			save: 'left on a Seat that was emptied',
			player1Data: null,
			commanders: undefined,
		},
	])('deletes a list $save', async ({ player1Data, commanders }) => {
		const { eventId, slotId } = await pastedSlot();

		const saved = await featureMatchSlotWriteModule().updateSetup({
			eventId,
			slotId,
			input: { player1Data },
		});

		expect(held(saved.player1Data)?.commanders).toEqual(commanders);
		expect(held(saved.player1Data)?.featureMatchDeckList ?? null).toBeNull();
		expect(await storedLists(slotId)).toEqual([]);
	});

	// The settling rules are ADR-0057's, here for Seats only a Commander Slot has.
	it('leaves a list two Seats name with the Seat that held it', async () => {
		const staged = await stageSlot();
		const { deckList } = await pasteOffered(staged.eventId, staged.slotId, 'player4');
		const reference = { id: deckList.id, mainboardCount: 8 };

		const saved = await featureMatchSlotWriteModule().updateSetup({
			...staged,
			input: {
				player3Data: {
					...seatHolding([ASHLING], reference),
					name: 'Cyd',
				},
				player4Data: {
					...seatHolding([ASHLING], reference),
					name: 'Dee',
				},
			},
		});

		expect(held(saved.player3Data)?.featureMatchDeckList).toBeUndefined();
		expect(held(saved.player4Data)?.featureMatchDeckList).toEqual(reference);
	});

	it('refuses a Seat\'s Deck List on a Two-Player Event', async () => {
		const { eventId, slotId } = await stageSlot('two-player');

		await expect(featureMatchSlotWriteModule().updateSetup({
			eventId,
			slotId,
			input: {
				player1Data: {
					name: 'Ana',
					gameData: {
						type: 'mtg',
						featureMatchDeckList: { id: 1, mainboardCount: 60 },
					},
				},
			},
		})).rejects.toMatchObject({ statusCode: 400 });
	});

	it('takes no Deck List from the write that creates a Slot', async () => {
		const { eventId, deckListId } = await pastedSlot();

		const created = await featureMatchSlotWriteModule().create({
			eventId,
			input: {
				player1Data: seatHolding([ANIMAR], { id: deckListId, mainboardCount: 8 }),
			},
		});

		expect(held(created.player1Data)).toMatchObject({
			commanders: [ANIMAR],
		});
		expect(held(created.player1Data)?.featureMatchDeckList).toBeUndefined();
	});
});
