import type { DbCard, DbEventCardNameOverride } from '~~/server/db/schema';
import { eq } from 'drizzle-orm';
import { db } from '~~/server/db';
import { cards, eventCardNameOverrides } from '~~/server/db/schema';

export interface EventCardNameOverrideResolved extends DbEventCardNameOverride {
	card: DbCard;
}

export function eventCardNameOverrideService() {
	const listResolvedByEvent = async (eventId: number): Promise<EventCardNameOverrideResolved[]> => {
		const rows = await db
			.select({
				id: eventCardNameOverrides.id,
				eventId: eventCardNameOverrides.eventId,
				inputName: eventCardNameOverrides.inputName,
				normalizedInputName: eventCardNameOverrides.normalizedInputName,
				inputSetCode: eventCardNameOverrides.inputSetCode,
				normalizedInputSetCode: eventCardNameOverrides.normalizedInputSetCode,
				resolvedCardId: eventCardNameOverrides.resolvedCardId,
				createdAt: eventCardNameOverrides.createdAt,
				updatedAt: eventCardNameOverrides.updatedAt,
				cardId: cards.id,
				cardName: cards.name,
				cardGame: cards.game,
				cardScryfallId: cards.scryfallId,
				cardOracleId: cards.oracleId,
				cardType: cards.cardType,
				cardColors: cards.colors,
				cardCmc: cards.cmc,
				cardManaCost: cards.manaCost,
				cardDeckCounterTypes: cards.deckCounterTypes,
				cardDeckTokens: cards.deckTokens,
				cardCreatedAt: cards.createdAt,
				cardUpdatedAt: cards.updatedAt,
			})
			.from(eventCardNameOverrides)
			.innerJoin(cards, eq(eventCardNameOverrides.resolvedCardId, cards.id))
			.where(eq(eventCardNameOverrides.eventId, eventId));

		return rows.map(row => ({
			id: row.id,
			eventId: row.eventId,
			inputName: row.inputName,
			normalizedInputName: row.normalizedInputName,
			inputSetCode: row.inputSetCode,
			normalizedInputSetCode: row.normalizedInputSetCode,
			resolvedCardId: row.resolvedCardId,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
			card: {
				id: row.cardId,
				name: row.cardName,
				game: row.cardGame,
				scryfallId: row.cardScryfallId,
				oracleId: row.cardOracleId,
				cardType: row.cardType,
				colors: row.cardColors,
				cmc: row.cardCmc,
				manaCost: row.cardManaCost,
				deckCounterTypes: row.cardDeckCounterTypes,
				deckTokens: row.cardDeckTokens,
				createdAt: row.cardCreatedAt,
				updatedAt: row.cardUpdatedAt,
			},
		}));
	};

	return {
		listResolvedByEvent,
	};
}
