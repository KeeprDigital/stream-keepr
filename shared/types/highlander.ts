import type { DeckListCompartment, PointsSystem } from './enums';

export type HighlanderStatus = 'legal' | 'illegal' | 'unknown';

export interface HighlanderPointedCard {
	name: string;
	points: number;
	compartments: DeckListCompartment[];
	totalQuantity: number;
	pointedAs?: 'companion';
}

export interface HighlanderDuplicateCard {
	name: string;
	quantity: number;
}

export interface HighlanderUnknownCard {
	name: string;
	missing: Array<'oracleId'>;
}

export interface HighlanderDeckSummary {
	system: PointsSystem;
	status: HighlanderStatus;
	points: number;
	maxPoints: number | null;
	hasReserveListCards: boolean | null;
	pointedCards: HighlanderPointedCard[];
	duplicateCards: HighlanderDuplicateCard[];
	unknownCards: HighlanderUnknownCard[];
}
