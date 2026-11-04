import type { DbFeatureMatchDeckListEntryInsert } from '~~/server/db/schema';
import type { PlayerSlotData } from '~~/shared/api';
import type { FeatureMatchDeckListReference, FeatureMatchDeckListView, SavedFeatureMatchDeckList } from '~~/shared/types/featureMatchDeckList';
import { and, asc, eq, lt, not } from 'drizzle-orm';
import { db } from '~~/server/db';
import { cards, featureMatchDeckListEntries, featureMatchDeckLists } from '~~/server/db/schema';
import { featureMatchDeckListView } from '~~/server/modules/feature-match-deck-list/paste';
import { opCatalogueCardColumns, opCatalogueRowFor, toOpCatalogueCard } from '~~/server/services/opCardCatalogue';
import { chunkRowsWithinParameterBudget, inJsonArray } from '~~/server/utils/db';
import { runCompensation } from '~~/server/utils/errors';
import { getOpGameData } from '~~/shared/utils/gameData';

/** The Deck List a side's slot data references, if any. */
export function deckListReferenceOf(data: PlayerSlotData | null | undefined): FeatureMatchDeckListReference | null {
	if (data?.gameData?.type !== 'op')
		return null;
	return getOpGameData(data.gameData).featureMatchDeckList ?? null;
}

/** Storage of Feature Match Deck Lists: each entry a card number, its card read from the card catalogue (ADR-0074). */
export function featureMatchDeckListService() {
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
		const insertEntries = (chunk: DbFeatureMatchDeckListEntryInsert[]) => db.insert(featureMatchDeckListEntries).values(chunk);
		const [first, ...rest] = chunkRowsWithinParameterBudget(rows, insertEntries).map(insertEntries);
		if (first) {
			try {
				await db.batch([first, ...rest]);
			}
			catch (error) {
				await runCompensation(error, () => db.delete(featureMatchDeckLists).where(eq(featureMatchDeckLists.id, deckList.id)));
				throw error;
			}
		}
		return deckList.id;
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
			...featureMatchDeckListView(rows.map(row => ({
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

	/** Deletes this Slot's Deck Lists older than `id` that neither side's data holds. */
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
		findById,
		referencesFor,
		remove,
		removeUnheldBefore,
	};
}
