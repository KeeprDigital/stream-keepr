import type { PlayerDeckSelection } from '~~/server/services/playerDeck';
import type { PointsSystem } from '~~/shared/types/enums';
import type { PlayerDeckCardEntry, PlayerDeckCollectionResponse, PlayerDeckResponse } from '~~/shared/types/metagame';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '~~/server/db';
import { cards, phases, playerDeckCards } from '~~/server/db/schema';
import { resolvePlayerDeckDetails } from '~~/server/mappers/playerDeck';
import { archetypeService } from '~~/server/services/archetype';
import { playerDeckService } from '~~/server/services/playerDeck';
import { playerDeckCompanionService } from '~~/server/services/playerDeckCompanion';
import { evaluateHighlanderDeck, getPointsByOracleId } from '~~/shared/utils/highlander';

export function playerDeckCardService() {
	/** Load all submitted decks for a player and identify the context-selected deck. */
	const getPlayerDecks = async (
		eventId: number,
		playerId: number,
		pointsSystem: PointsSystem | null = null,
		selection: PlayerDeckSelection = {},
	): Promise<PlayerDeckCollectionResponse> => {
		const deckSvc = playerDeckService();
		const deckRows = await deckSvc.listByPlayer(eventId, playerId);
		if (deckRows.length === 0) {
			return { decks: [], selectedDeckId: null };
		}

		const deckIds = deckRows.map(deck => deck.id);
		const [cardRows, phaseRows, selectedDeck, reviewedArchetypes] = await Promise.all([
			db
				.select({
					deckId: playerDeckCards.deckId,
					cardId: playerDeckCards.cardId,
					name: cards.name,
					scryfallId: cards.scryfallId,
					oracleId: cards.oracleId,
					cardType: cards.cardType,
					colors: cards.colors,
					cmc: cards.cmc,
					manaCost: cards.manaCost,
					deckCounterTypes: cards.deckCounterTypes,
					deckTokens: cards.deckTokens,
					quantity: playerDeckCards.quantity,
					compartment: playerDeckCards.compartment,
					sortOrder: playerDeckCards.sortOrder,
				})
				.from(playerDeckCards)
				.innerJoin(cards, eq(playerDeckCards.cardId, cards.id))
				.where(inArray(playerDeckCards.deckId, deckIds))
				.orderBy(asc(playerDeckCards.deckId), asc(playerDeckCards.sortOrder)),
			db
				.select({
					id: phases.id,
					name: phases.name,
					formatExternalId: phases.formatExternalId,
				})
				.from(phases)
				.where(and(eq(phases.eventId, eventId)))
				.orderBy(asc(phases.sortOrder), asc(phases.id)),
			deckSvc.selectFromDecks(eventId, deckRows, selection),
			archetypeService().findManyByIds(
				eventId,
				deckRows.flatMap(deck => deck.reviewedAt != null && deck.archetypeId != null ? [deck.archetypeId] : []),
			),
		]);
		const archetypesById = new Map(reviewedArchetypes.map(archetype => [archetype.id, archetype]));

		const pointsByOracleId = pointsSystem ? getPointsByOracleId(pointsSystem) : new Map<string, number>();
		const cardsByDeckId = new Map<number, typeof cardRows>();
		for (const row of cardRows) {
			const existing = cardsByDeckId.get(row.deckId) ?? [];
			existing.push(row);
			cardsByDeckId.set(row.deckId, existing);
		}

		const decks: PlayerDeckResponse[] = await Promise.all(deckRows.map(async (deck) => {
			const rows = cardsByDeckId.get(deck.id) ?? [];
			const companion = await playerDeckCompanionService().getDeckCompanion(deck.id);
			const matchingPhases = phaseRows.filter(phase => phase.formatExternalId === deck.formatExternalId);
			const deckCards: PlayerDeckCardEntry[] = rows.map(row => ({
				cardId: row.cardId,
				name: row.name,
				scryfallId: row.scryfallId,
				cardType: row.cardType,
				colors: row.colors,
				cmc: row.cmc,
				manaCost: row.manaCost,
				deckCounterTypes: row.deckCounterTypes,
				deckTokens: row.deckTokens,
				quantity: row.quantity,
				compartment: row.compartment,
				sortOrder: row.sortOrder,
				highlanderPoints: row.oracleId ? pointsByOracleId.get(row.oracleId) ?? null : null,
			}));
			const highlander = pointsSystem
				? evaluateHighlanderDeck(
						pointsSystem,
						rows.map(row => ({
							name: row.name,
							oracleId: row.oracleId,
							cardType: row.cardType,
							quantity: row.quantity,
							compartment: row.compartment,
						})),
						companion ? { name: companion.name, oracleId: companion.oracleId } : null,
					)
				: undefined;
			const details = resolvePlayerDeckDetails(
				deck,
				deck.archetypeId == null ? null : archetypesById.get(deck.archetypeId),
			);

			return {
				id: deck.id,
				playerId: deck.playerId,
				externalId: deck.externalId,
				formatExternalId: deck.formatExternalId,
				phaseIds: matchingPhases.map(phase => phase.id),
				phaseName: matchingPhases[0]?.name ?? null,
				...details,
				sortOrder: deck.sortOrder,
				isPrimary: deck.isPrimary,
				archetypeId: deck.archetypeId,
				reviewedAt: deck.reviewedAt,
				cards: deckCards,
				companion,
				...(highlander ? { highlander } : {}),
			};
		}));

		return {
			decks,
			selectedDeckId: selectedDeck?.id ?? null,
		};
	};

	return {
		getPlayerDecks,
	};
}
