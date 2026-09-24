import type { DbPlayerDeckUnresolvedCard, DeckListCompartment } from '~~/server/db/schema';
import type { UnresolvedDeckEntryType } from '~~/shared/types/enums';
import { and, asc, eq, getTableColumns } from 'drizzle-orm';
import { db } from '~~/server/db';
import { archetypes, phases, playerDecks, playerDeckUnresolvedCards, players } from '~~/server/db/schema';
import { hasReviewedPlayerDeckDetails } from '~~/server/mappers/playerDeck';

export interface UnresolvedDeckCardListEntry {
	id: number;
	eventId: number;
	playerId: number;
	playerName: string;
	deckId: number;
	formatExternalId: string;
	phaseName: string | null;
	deckName: string;
	entryType: UnresolvedDeckEntryType;
	originalName: string;
	setCode: string | null;
	quantity: number;
	compartment: DeckListCompartment | null;
	sortOrder: number;
	cardType: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export function playerDeckUnresolvedCardService() {
	const listByEventId = async (eventId: number): Promise<UnresolvedDeckCardListEntry[]> => {
		const [rows, phaseRows] = await Promise.all([
			db
				.select({
					id: playerDeckUnresolvedCards.id,
					eventId: playerDecks.eventId,
					playerId: playerDecks.playerId,
					playerName: players.name,
					deckId: playerDecks.id,
					formatExternalId: playerDecks.formatExternalId,
					deckName: playerDecks.name,
					deckArchetypeId: playerDecks.archetypeId,
					reviewedAt: playerDecks.reviewedAt,
					archetypeId: archetypes.id,
					archetypeName: archetypes.name,
					entryType: playerDeckUnresolvedCards.entryType,
					originalName: playerDeckUnresolvedCards.originalName,
					setCode: playerDeckUnresolvedCards.setCode,
					quantity: playerDeckUnresolvedCards.quantity,
					compartment: playerDeckUnresolvedCards.compartment,
					sortOrder: playerDeckUnresolvedCards.sortOrder,
					cardType: playerDeckUnresolvedCards.cardType,
					createdAt: playerDeckUnresolvedCards.createdAt,
					updatedAt: playerDeckUnresolvedCards.updatedAt,
				})
				.from(playerDeckUnresolvedCards)
				.innerJoin(playerDecks, eq(playerDeckUnresolvedCards.deckId, playerDecks.id))
				.innerJoin(players, eq(playerDecks.playerId, players.id))
				.leftJoin(archetypes, eq(playerDecks.archetypeId, archetypes.id))
				.where(eq(playerDecks.eventId, eventId))
				.orderBy(
					asc(players.name),
					asc(playerDecks.sortOrder),
					asc(playerDeckUnresolvedCards.sortOrder),
				),
			db
				.select({ name: phases.name, formatExternalId: phases.formatExternalId })
				.from(phases)
				.where(eq(phases.eventId, eventId))
				.orderBy(asc(phases.sortOrder), asc(phases.id)),
		]);

		const phaseNameByFormat = new Map<string, string>();
		for (const phase of phaseRows) {
			if (phase.formatExternalId && !phaseNameByFormat.has(phase.formatExternalId)) {
				phaseNameByFormat.set(phase.formatExternalId, phase.name);
			}
		}

		return rows.map((row) => {
			const reviewed = row.archetypeName != null && hasReviewedPlayerDeckDetails(
				{ archetypeId: row.deckArchetypeId, reviewedAt: row.reviewedAt },
				row.archetypeId == null ? null : { id: row.archetypeId },
			);
			const {
				deckArchetypeId: _deckArchetypeId,
				reviewedAt: _reviewedAt,
				archetypeId: _archetypeId,
				archetypeName: _archetypeName,
				...entry
			} = row;
			return {
				...entry,
				deckName: reviewed ? row.archetypeName! : row.deckName,
				phaseName: phaseNameByFormat.get(row.formatExternalId) ?? null,
			};
		});
	};

	const findById = async (id: number, eventId: number): Promise<DbPlayerDeckUnresolvedCard | undefined> => {
		const [row] = await db
			.select(getTableColumns(playerDeckUnresolvedCards))
			.from(playerDeckUnresolvedCards)
			.innerJoin(playerDecks, eq(playerDeckUnresolvedCards.deckId, playerDecks.id))
			.where(and(
				eq(playerDeckUnresolvedCards.id, id),
				eq(playerDecks.eventId, eventId),
			))
			.limit(1);

		return row;
	};

	const listMatchingEntries = async (
		eventId: number,
		normalizedOriginalName: string,
		normalizedSetCode: string,
		entryType: UnresolvedDeckEntryType,
	): Promise<DbPlayerDeckUnresolvedCard[]> => {
		return await db
			.select(getTableColumns(playerDeckUnresolvedCards))
			.from(playerDeckUnresolvedCards)
			.innerJoin(playerDecks, eq(playerDeckUnresolvedCards.deckId, playerDecks.id))
			.where(and(
				eq(playerDecks.eventId, eventId),
				eq(playerDeckUnresolvedCards.normalizedOriginalName, normalizedOriginalName),
				eq(playerDeckUnresolvedCards.normalizedSetCode, normalizedSetCode),
				eq(playerDeckUnresolvedCards.entryType, entryType),
			))
			.orderBy(
				asc(playerDecks.sortOrder),
				asc(playerDeckUnresolvedCards.sortOrder),
			);
	};

	return {
		listByEventId,
		findById,
		listMatchingEntries,
	};
}
