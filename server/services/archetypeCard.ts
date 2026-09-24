import type { DbCard } from '~~/server/db/schema';
import { asc, eq, inArray } from 'drizzle-orm';
import { db } from '~~/server/db';
import { archetypeCards, cards } from '~~/server/db/schema';
import { chunkArray, SAFE_INARRAY_SIZE } from '~~/server/utils/db';

export interface ArchetypeKeyCard extends DbCard {
	sortOrder: number;
}

export function archetypeCardService() {
	/**
	 * Get all key cards for an archetype, ordered by sort_order.
	 */
	const getKeyCards = async (archetypeId: number): Promise<ArchetypeKeyCard[]> => {
		const rows = await db
			.select({
				id: cards.id,
				name: cards.name,
				game: cards.game,
				scryfallId: cards.scryfallId,
				oracleId: cards.oracleId,
				cardType: cards.cardType,
				colors: cards.colors,
				cmc: cards.cmc,
				manaCost: cards.manaCost,
				deckCounterTypes: cards.deckCounterTypes,
				deckTokens: cards.deckTokens,
				createdAt: cards.createdAt,
				updatedAt: cards.updatedAt,
				sortOrder: archetypeCards.sortOrder,
			})
			.from(archetypeCards)
			.innerJoin(cards, eq(archetypeCards.cardId, cards.id))
			.where(eq(archetypeCards.archetypeId, archetypeId))
			.orderBy(asc(archetypeCards.sortOrder));

		return rows;
	};

	/**
	 * Set key cards for an archetype (replaces existing ones).
	 * Max 5 cards enforced at service level.
	 * Uses D1 batch: delete all existing, then insert new ones.
	 */
	const setKeyCards = async (archetypeId: number, cardIds: number[]): Promise<ArchetypeKeyCard[]> => {
		if (cardIds.length > 5) {
			throw new Error('Archetypes can have at most 5 key cards');
		}

		// Build batch: first delete all, then insert new ones
		const deleteQuery = db
			.delete(archetypeCards)
			.where(eq(archetypeCards.archetypeId, archetypeId));

		if (cardIds.length === 0) {
			await deleteQuery;
			return [];
		}

		const insertValues = cardIds.map((cardId, index) => ({
			archetypeId,
			cardId,
			sortOrder: index,
		}));

		await db.batch([
			deleteQuery,
			db.insert(archetypeCards).values(insertValues),
		]);

		return getKeyCards(archetypeId);
	};

	/**
	 * Get all archetype_cards rows for a set of archetype IDs.
	 * Returns a map of archetypeId → ArchetypeKeyCard[].
	 */
	const getKeyCardsByArchetypeIds = async (
		archetypeIds: number[],
	): Promise<Map<number, ArchetypeKeyCard[]>> => {
		if (archetypeIds.length === 0)
			return new Map();

		const rowGroups = await Promise.all(
			chunkArray(archetypeIds, SAFE_INARRAY_SIZE).map(chunk => db
				.select({
					id: cards.id,
					name: cards.name,
					game: cards.game,
					scryfallId: cards.scryfallId,
					oracleId: cards.oracleId,
					cardType: cards.cardType,
					colors: cards.colors,
					cmc: cards.cmc,
					manaCost: cards.manaCost,
					deckCounterTypes: cards.deckCounterTypes,
					deckTokens: cards.deckTokens,
					createdAt: cards.createdAt,
					updatedAt: cards.updatedAt,
					sortOrder: archetypeCards.sortOrder,
					archetypeId: archetypeCards.archetypeId,
				})
				.from(archetypeCards)
				.innerJoin(cards, eq(archetypeCards.cardId, cards.id))
				.where(inArray(archetypeCards.archetypeId, chunk))
				.orderBy(asc(archetypeCards.archetypeId), asc(archetypeCards.sortOrder))),
		);
		const rows = rowGroups.flat().sort((a, b) => {
			if (a.archetypeId !== b.archetypeId)
				return a.archetypeId - b.archetypeId;
			return a.sortOrder - b.sortOrder;
		});

		const map = new Map<number, ArchetypeKeyCard[]>();
		for (const { archetypeId, ...card } of rows) {
			const existing = map.get(archetypeId) ?? [];
			existing.push(card);
			map.set(archetypeId, existing);
		}

		return map;
	};

	return {
		getKeyCards,
		setKeyCards,
		getKeyCardsByArchetypeIds,
	};
}
