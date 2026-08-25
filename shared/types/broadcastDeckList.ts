export type BroadcastDeckListCompartment = 'mainboard' | 'sideboard' | 'companion';

export interface BroadcastDeckListImportFailureDetail {
	lineNumber?: number;
	code: string;
	message: string;
	sourceText?: string;
}

export interface BroadcastDeckListEntryResponse {
	id: number;
	listId: number;
	compartment: BroadcastDeckListCompartment;
	quantity: number;
	sortOrder: number;
	canonicalName: string;
	scryfallId: string;
	oracleId: string | null;
	setCode: string;
	collectorNumber: string | null;
	cardType: string | null;
	colors: string | null;
	manaCost: string | null;
	manaValue: number | null;
	deckCounterTypes: string[];
}

export interface BroadcastDeckListSummaryResponse {
	id: number;
	eventId: number;
	name: string;
	archetypeLabel: string | null;
	colors: string | null;
	revision: number;
	mainboardQuantity: number;
	sideboardQuantity: number;
	hasCompanion: boolean;
	createdAt: Date;
	updatedAt: Date;
}

export interface BroadcastDeckListResponse extends BroadcastDeckListSummaryResponse {
	sourceText: string;
	entries: BroadcastDeckListEntryResponse[];
}

export interface CreateBroadcastDeckListInput {
	name: string;
	sourceText: string;
	archetypeLabel?: string | null;
	colors?: string | null;
}

export interface UpdateBroadcastDeckListInput {
	expectedRevision: number;
	name?: string;
	sourceText?: string;
	archetypeLabel?: string | null;
	colors?: string | null;
}

export interface DeleteBroadcastDeckListInput {
	expectedRevision: number;
}

export interface BroadcastDeckListValidationFailure {
	code: 'BROADCAST_DECK_LIST_INVALID';
	errors: BroadcastDeckListImportFailureDetail[];
}

export const BROADCAST_DECK_LIST_REVISION_CONFLICT = 'BROADCAST_DECK_LIST_REVISION_CONFLICT';
