import type { BatchItem } from 'drizzle-orm/batch';
import type { DbFeatureMatchDeckListEntryInsert, DbFeatureMatchDeckListMtgEntryInsert } from '~~/server/db/schema';
import type { PlayerSlotData } from '~~/shared/api';
import type { CommanderDeckListEntry, FeatureMatchDeckListReference, FeatureMatchDeckListView, SavedCommanderDeckList, SavedFeatureMatchDeckList } from '~~/shared/types/featureMatchDeckList';
import { and, asc, eq, lt, not } from 'drizzle-orm';
import { db } from '~~/server/db';
import { cards, featureMatchDeckListEntries, featureMatchDeckListMtgEntries, featureMatchDeckLists } from '~~/server/db/schema';
import { opDeckListView } from '~~/server/modules/op-deck-list-write/paste';
import { opCatalogueCardColumns, opCatalogueRowFor, toOpCatalogueCard } from '~~/server/services/opCardCatalogue';
import { chunkRowsWithinParameterBudget, inJsonArray } from '~~/server/utils/db';
import { runCompensation } from '~~/server/utils/errors';
import { getOpGameData } from '~~/shared/utils/gameData';

/** The Deck List a Seat's slot data references, if any: a One Piece Seat's, or a Commander Seat's (ADR-0087). */
export function deckListReferenceOf(data: PlayerSlotData | null | undefined): FeatureMatchDeckListReference | null {
	if (data?.gameData?.type === 'mtg')
		return data.gameData.featureMatchDeckList ?? null;
	if (data?.gameData?.type !== 'op')
		return null;
	return getOpGameData(data.gameData).featureMatchDeckList ?? null;
}

/**
 * Storage of Feature Match Deck Lists. A One Piece entry is a card number, its
 * card read from the card catalogue (ADR-0074); a Commander Seat's is one
 * printing of a Magic: The Gathering card, held as it was resolved (ADR-0087).
 */
export function featureMatchDeckListService() {
	/** Stores a Deck List's entries in one batch, or deletes the Deck List they were for. */
	const insertEntries = async (deckListId: number, [first, ...rest]: BatchItem<'sqlite'>[]): Promise<void> => {
		if (!first)
			return;
		try {
			await db.batch([first, ...rest]);
		}
		catch (error) {
			await runCompensation(error, () => db.delete(featureMatchDeckLists).where(eq(featureMatchDeckLists.id, deckListId)));
			throw error;
		}
	};

	/** Stores a Deck List for a Slot, entries and all, or nothing. An entry keeps its number and quantity; its card is the catalogue's. */
	const create = async (eventId: number, slotId: number, sourceText: string, view: FeatureMatchDeckListView): Promise<number> => {
		const [deckList] = await db.insert(featureMatchDeckLists)
			.values({
				eventId,
				slotId,
				sourceText,
				mainboardCount: view.mainboardCount,
			})
			.returning({ id: featureMatchDeckLists.id });
		if (!deckList)
			throw new Error('Failed to create Feature Match Deck List');

		const rows: DbFeatureMatchDeckListEntryInsert[] = view.entries.map((entry, sortOrder) => ({
			deckListId: deckList.id,
			sortOrder,
			quantity: entry.quantity,
			cardNumber: entry.number,
		}));
		const insert = (chunk: DbFeatureMatchDeckListEntryInsert[]) => db.insert(featureMatchDeckListEntries).values(chunk);
		await insertEntries(deckList.id, chunkRowsWithinParameterBudget(rows, insert).map(insert));
		return deckList.id;
	};

	/** Stores a Commander Seat's Deck List, every card and all, or nothing. */
	const createCommander = async (
		eventId: number,
		slotId: number,
		sourceText: string,
		entries: readonly CommanderDeckListEntry[],
		mainboardCount: number,
	): Promise<number> => {
		const [deckList] = await db.insert(featureMatchDeckLists)
			.values({ eventId, slotId, sourceText, mainboardCount })
			.returning({ id: featureMatchDeckLists.id });
		if (!deckList)
			throw new Error('Failed to create Feature Match Deck List');

		const rows: DbFeatureMatchDeckListMtgEntryInsert[] = entries.map((entry, sortOrder) => ({
			deckListId: deckList.id,
			sortOrder,
			quantity: entry.quantity,
			canonicalName: entry.name,
			scryfallId: entry.scryfallId,
			setCode: entry.setCode,
			collectorNumber: entry.collectorNumber,
			cardType: entry.cardType,
			colors: entry.colorIdentity,
			manaCost: entry.manaCost,
			manaValue: entry.manaValue,
		}));
		const insert = (chunk: DbFeatureMatchDeckListMtgEntryInsert[]) => db.insert(featureMatchDeckListMtgEntries).values(chunk);
		await insertEntries(deckList.id, chunkRowsWithinParameterBudget(rows, insert).map(insert));
		return deckList.id;
	};

	/** A Commander Seat's Deck List of this Slot, its cards in pasted order. */
	const findCommanderById = async (id: number, slotId: number, eventId: number): Promise<SavedCommanderDeckList | null> => {
		const deckList = await db.query.featureMatchDeckLists.findFirst({
			where: and(
				eq(featureMatchDeckLists.id, id),
				eq(featureMatchDeckLists.slotId, slotId),
				eq(featureMatchDeckLists.eventId, eventId),
			),
		});
		if (!deckList)
			return null;
		const rows = await db.select()
			.from(featureMatchDeckListMtgEntries)
			.where(eq(featureMatchDeckListMtgEntries.deckListId, id))
			.orderBy(asc(featureMatchDeckListMtgEntries.sortOrder));
		return {
			id: deckList.id,
			slotId: deckList.slotId,
			sourceText: deckList.sourceText,
			entries: rows.map(row => ({
				quantity: row.quantity,
				scryfallId: row.scryfallId,
				name: row.canonicalName,
				setCode: row.setCode,
				collectorNumber: row.collectorNumber,
				cardType: row.cardType,
				colorIdentity: row.colors ?? '',
				manaCost: row.manaCost,
				manaValue: row.manaValue,
			})),
		};
	};

	/** The printings each of a Slot's Commander Deck Lists among `ids` holds, with how many of each. */
	const commanderCardsFor = async (slotId: number, ids: readonly number[]): Promise<Map<number, Array<{ scryfallId: string; quantity: number }>>> => {
		const cardsByList = new Map<number, Array<{ scryfallId: string; quantity: number }>>();
		if (ids.length === 0)
			return cardsByList;
		const rows = await db.select({
			deckListId: featureMatchDeckListMtgEntries.deckListId,
			scryfallId: featureMatchDeckListMtgEntries.scryfallId,
			quantity: featureMatchDeckListMtgEntries.quantity,
		})
			.from(featureMatchDeckListMtgEntries)
			.innerJoin(featureMatchDeckLists, eq(featureMatchDeckLists.id, featureMatchDeckListMtgEntries.deckListId))
			.where(and(eq(featureMatchDeckLists.slotId, slotId), inJsonArray(featureMatchDeckLists.id, [...ids])));
		for (const { deckListId, ...card } of rows)
			cardsByList.set(deckListId, [...cardsByList.get(deckListId) ?? [], card]);
		return cardsByList;
	};

	const findById = async (id: number, slotId: number, eventId: number): Promise<SavedFeatureMatchDeckList | null> => {
		const deckList = await db.query.featureMatchDeckLists.findFirst({
			where: and(
				eq(featureMatchDeckLists.id, id),
				eq(featureMatchDeckLists.slotId, slotId),
				eq(featureMatchDeckLists.eventId, eventId),
			),
		});
		if (!deckList)
			return null;
		const rows = await db.select({
			number: featureMatchDeckListEntries.cardNumber,
			quantity: featureMatchDeckListEntries.quantity,
			...opCatalogueCardColumns,
		})
			.from(featureMatchDeckListEntries)
			.leftJoin(cards, opCatalogueRowFor(featureMatchDeckListEntries.cardNumber))
			.where(eq(featureMatchDeckListEntries.deckListId, id))
			.orderBy(asc(featureMatchDeckListEntries.sortOrder));
		return {
			id: deckList.id,
			slotId: deckList.slotId,
			sourceText: deckList.sourceText,
			...opDeckListView(rows.map(row => ({
				number: row.number,
				quantity: row.quantity,
				card: toOpCatalogueCard(row),
			}))),
		};
	};

	/** The references a Slot's Deck Lists among `ids` answer to, by id. */
	const referencesFor = async (slotId: number, ids: readonly number[]): Promise<Map<number, FeatureMatchDeckListReference>> => {
		if (ids.length === 0)
			return new Map();
		const rows = await db.select({ id: featureMatchDeckLists.id, mainboardCount: featureMatchDeckLists.mainboardCount })
			.from(featureMatchDeckLists)
			.where(and(eq(featureMatchDeckLists.slotId, slotId), inJsonArray(featureMatchDeckLists.id, [...ids])));
		return new Map(rows.map(row => [row.id, row]));
	};

	const remove = async (slotId: number, ids: readonly number[]): Promise<void> => {
		if (ids.length === 0)
			return;
		await db.delete(featureMatchDeckLists)
			.where(and(eq(featureMatchDeckLists.slotId, slotId), inJsonArray(featureMatchDeckLists.id, [...ids])));
	};

	/** Deletes this Slot's Deck Lists older than `id` that no Seat's data holds. */
	const removeUnheldBefore = async (slotId: number, id: number, sides: readonly (PlayerSlotData | null | undefined)[]): Promise<void> => {
		const held = sides.map(deckListReferenceOf).filter(reference => reference !== null).map(reference => reference.id);
		await db.delete(featureMatchDeckLists).where(and(
			eq(featureMatchDeckLists.slotId, slotId),
			lt(featureMatchDeckLists.id, id),
			not(inJsonArray(featureMatchDeckLists.id, held)),
		));
	};

	return {
		create,
		createCommander,
		findById,
		findCommanderById,
		commanderCardsFor,
		referencesFor,
		remove,
		removeUnheldBefore,
	};
}
