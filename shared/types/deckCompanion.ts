import type { DeckCompanionSource } from './enums';

export interface DeckCompanion {
	cardId: number;
	name: string;
	scryfallId: string | null;
	oracleId: string | null;
	source: DeckCompanionSource;
	usesExistingSideboardSlot: boolean;
}

export interface SetDeckCompanionInput {
	deckId: number;
	name: string;
	scryfallId: string;
}
