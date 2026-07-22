import type { DbCard, DbPlayerDeckCompanionInsert } from '~~/server/db/schema';
import type { DeckCompanion } from '~~/shared/types/deckCompanion';
import { and, eq } from 'drizzle-orm';
import { db } from 'hub:db';
import { cards, playerDeckCards, playerDeckCompanions } from '~~/server/db/schema';

const MAX_MTG_SIDEBOARD_SIZE = 15;

export class DeckCompanionValidationError extends Error {}

export interface ImportedDeckCardState {
	cardId: number;
	quantity: number;
	compartment: 'mainboard' | 'sideboard';
}

type UpsertDeckCompanionRow = Omit<DbPlayerDeckCompanionInsert, 'id' | 'createdAt' | 'updatedAt'>;

async function getCompanionRow(deckId: number) {
	const [row] = await db
		.select()
		.from(playerDeckCompanions)
		.where(eq(playerDeckCompanions.deckId, deckId))
		.limit(1);

	return row;
}

async function getSideboardState(deckId: number, companionCardId: number) {
	const rows = await db
		.select({
			cardId: playerDeckCards.cardId,
			quantity: playerDeckCards.quantity,
		})
		.from(playerDeckCards)
		.where(and(
			eq(playerDeckCards.deckId, deckId),
			eq(playerDeckCards.compartment, 'sideboard'),
		));

	const totalCards = rows.reduce((sum, row) => sum + row.quantity, 0);
	const usesExistingSideboardSlot = rows.some(row => row.cardId === companionCardId);

	return {
		totalCards,
		usesExistingSideboardSlot,
		hasSpareSlot: totalCards < MAX_MTG_SIDEBOARD_SIZE,
	};
}

async function validateManualCompanion(deckId: number, companionCardId: number) {
	const sideboardState = await getSideboardState(deckId, companionCardId);
	if (!sideboardState.usesExistingSideboardSlot && !sideboardState.hasSpareSlot) {
		throw new DeckCompanionValidationError('Companion must already be in the sideboard or there must be an open sideboard slot.');
	}

	return sideboardState;
}

/**
 * Validate an imported companion against the card snapshot that will be written
 * in the same D1 batch. Keeping this pure avoids validating against the stale
 * pre-sync deck immediately before replacing it.
 */
export function validateImportedCompanionSnapshot(
	cardRows: ImportedDeckCardState[],
	companionCardId: number,
): void {
	const sideboardRows = cardRows.filter(row => row.compartment === 'sideboard');
	const totalCards = sideboardRows.reduce((sum, row) => sum + row.quantity, 0);
	const usesExistingSideboardSlot = sideboardRows.some(row => row.cardId === companionCardId);

	if (!usesExistingSideboardSlot && totalCards >= MAX_MTG_SIDEBOARD_SIZE) {
		throw new DeckCompanionValidationError('Imported companion requires an open sideboard slot or an existing sideboard copy.');
	}
}

/**
 * Manual companion choices are app-owned and take precedence over imported
 * Melee data. Returns false when an atomic imported write should be skipped.
 */
async function shouldSyncImportedCompanion(deckId: number, companionCardId: number): Promise<boolean> {
	const existing = await getCompanionRow(deckId);
	if (existing?.source === 'manual') {
		return false;
	}

	const sideboardState = await getSideboardState(deckId, companionCardId);
	if (!sideboardState.usesExistingSideboardSlot && !sideboardState.hasSpareSlot) {
		throw new DeckCompanionValidationError('Imported companion requires an open sideboard slot or an existing sideboard copy.');
	}

	return true;
}

async function writeCompanionRow(deckId: number, data: UpsertDeckCompanionRow) {
	const existing = await getCompanionRow(deckId);
	if (existing) {
		await db
			.update(playerDeckCompanions)
			.set({ ...data, updatedAt: new Date() })
			.where(eq(playerDeckCompanions.id, existing.id));
		return;
	}

	await db.insert(playerDeckCompanions).values(data);
}

async function mapDeckCompanion(
	row: {
		source: 'manual' | 'melee';
		companionCardId: number | null;
		name: string | null;
		scryfallId: string | null;
		oracleId: string | null;
	} | undefined,
	deckId: number,
): Promise<DeckCompanion | null> {
	if (!row?.companionCardId || !row.name) {
		return null;
	}

	const sideboardState = await getSideboardState(deckId, row.companionCardId);

	return {
		cardId: row.companionCardId,
		name: row.name,
		scryfallId: row.scryfallId,
		oracleId: row.oracleId,
		source: row.source,
		usesExistingSideboardSlot: sideboardState.usesExistingSideboardSlot,
	};
}

export function playerDeckCompanionService() {
	const getDeckCompanion = async (deckId: number): Promise<DeckCompanion | null> => {
		const [row] = await db
			.select({
				source: playerDeckCompanions.source,
				companionCardId: playerDeckCompanions.companionCardId,
				name: cards.name,
				scryfallId: cards.scryfallId,
				oracleId: cards.oracleId,
			})
			.from(playerDeckCompanions)
			.leftJoin(cards, eq(playerDeckCompanions.companionCardId, cards.id))
			.where(eq(playerDeckCompanions.deckId, deckId))
			.limit(1);

		return mapDeckCompanion(row, deckId);
	};

	const setManualCompanion = async (deckId: number, companionCard: DbCard): Promise<DeckCompanion> => {
		await validateManualCompanion(deckId, companionCard.id);
		await writeCompanionRow(deckId, {
			deckId,
			companionCardId: companionCard.id,
			source: 'manual',
		});

		const companion = await getDeckCompanion(deckId);
		if (!companion) {
			throw new Error('Failed to persist companion');
		}

		return companion;
	};

	const clearManualCompanion = async (deckId: number): Promise<void> => {
		await writeCompanionRow(deckId, {
			deckId,
			companionCardId: null,
			source: 'manual',
		});
	};

	return {
		getDeckCompanion,
		setManualCompanion,
		clearManualCompanion,
		shouldSyncImportedCompanion,
	};
}
