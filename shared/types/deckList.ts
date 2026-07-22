import type { DeckTokenRequirement } from '../utils/deckTokens';
import type { DeckCompanion } from './deckCompanion';
import type { DeckListCompartment } from './enums';
import type { HighlanderDeckSummary } from './highlander';

export interface DeckListCard {
	name: string;
	/** Set code is optional — not present in player deck card entries from the API */
	setCode?: string | null;
	quantity: number;
	compartment: DeckListCompartment;
	/** Nullable — card type may not be available for all card sources */
	cardType: string | null;
	scryfallId: string | null;
	deckCounterTypes?: string[];
	deckTokens?: DeckTokenRequirement[];
	highlanderPoints?: number | null;
}

/**
 * Pre-calculated deck statistics by card type (mainboard only)
 */
export interface DeckListStats {
	creatures: number;
	instants: number;
	sorceries: number;
	enchantments: number;
	artifacts: number;
	planeswalkers: number;
	lands: number;
	other: number;
}

/**
 * Mana pip counts by color (WUBRG + colorless)
 */
export interface ManaPipCounts {
	W: number;
	U: number;
	B: number;
	R: number;
	G: number;
	C: number;
}

/**
 * Mana curve: mainboard card count by converted mana cost.
 * Key is the CMC value; CMC >= 7 is bucketed under key 7.
 */
export type ManaCurve = Record<number, number>;

/**
 * A single deck list with phase information
 * Players can have multiple submitted decks, each tied to its upstream format.
 */
export interface PlayerDeckList {
	deckId: number;
	externalId: string;
	formatExternalId: string;
	phaseIds: number[];
	phaseName: string | null;
	name: string;
	colors: string;
	isPrimary: boolean;
	cards: DeckListCard[];
	stats?: DeckListStats;
	pips?: ManaPipCounts;
	curve?: ManaCurve;
	companion?: DeckCompanion | null;
	highlander?: HighlanderDeckSummary;
}
