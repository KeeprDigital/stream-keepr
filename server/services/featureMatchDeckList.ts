import type { DbFeatureMatchDeckListEntry, DbFeatureMatchDeckListEntryInsert } from '~~/server/db/schema';
import type { PlayerSlotData } from '~~/shared/api';
import type { FeatureMatchDeckListEntry, FeatureMatchDeckListReference, FeatureMatchDeckListView, SavedFeatureMatchDeckList } from '~~/shared/types/featureMatchDeckList';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '~~/server/db';
import { featureMatchDeckListEntries, featureMatchDeckLists } from '~~/server/db/schema';
import { featureMatchDeckListView } from '~~/server/modules/feature-match-deck-list/paste';
import { chunkRowsWithinParameterBudget, inJsonArray } from '~~/server/utils/db';
import { runCompensation } from '~~/server/utils/errors';
import { getOpGameData } from '~~/shared/utils/gameData';

/** The Deck List a side's slot data references, if any. */
export function deckListReferenceOf(data: PlayerSlotData | null | undefined): FeatureMatchDeckListReference | null {
	if (data?.gameData?.type !== 'op')
		return null;
	return getOpGameData(data.gameData).featureMatchDeckList ?? null;
}

function toEntry(row: DbFeatureMatchDeckListEntry): FeatureMatchDeckListEntry {
	return {
		number: row.cardNumber,
		quantity: row.quantity,
		card: row.name !== null && row.category !== null && row.imageUrl !== null
			? {
					name: row.name,
					category: row.category,
					colors: row.colors ?? [],
					cost: row.cost,
					power: row.power,
					counter: row.counter,
					imageUrl: row.imageUrl,
				}
			: null,
	};
}

/** Storage of Feature Match Deck Lists: each with its entries' inline card snapshots. */
export function featureMatchDeckListService() {
	/** Stores a Deck List for a Slot, entries and all, or nothing. */
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
			name: entry.card?.name ?? null,
			category: entry.card?.category ?? null,
			colors: entry.card?.colors ?? null,
			cost: entry.card?.cost ?? null,
			power: entry.card?.power ?? null,
			counter: entry.card?.counter ?? null,
			imageUrl: entry.card?.imageUrl ?? null,
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
		const rows = await db.select()
			.from(featureMatchDeckListEntries)
			.where(eq(featureMatchDeckListEntries.deckListId, id))
			.orderBy(asc(featureMatchDeckListEntries.sortOrder));
		return {
			id: deckList.id,
			slotId: deckList.slotId,
			sourceText: deckList.sourceText,
			...featureMatchDeckListView(rows.map(toEntry)),
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

	return {
		create,
		findById,
		referencesFor,
		remove,
	};
}
