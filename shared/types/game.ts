import type { OpCardColor } from './card/op';
import type { MetagameScope } from './enums';
import type { FeatureMatchDeckListReference } from './featureMatchDeckList';
import type { FeatureMatchDefaults } from './featureMatchDefaults';
import type { OpPlayerDeckListReference } from './opDeckList';

export interface CounterTypeConfig {
	key: string;
	label: string;
	shortLabel?: string;
	icon: string;
}

/**
 * The parts of Feature Match state a Card Game tracks beyond the clock, game
 * wins, turn number and the active and first player, which every Card Game
 * tracks. The Feature Match controls offer only what it tracks.
 */
export interface FeatureMatchStateTracking {
	life: boolean;
	mulligan: boolean;
	counters: boolean;
	overtime: boolean;
	/** Revealing the players' Sideboards; a One Piece Card Game Deck List has none. */
	sideboard: boolean;
}

/** What a Card Game's Metagame reads (ADR-0074). */
export interface MetagameRules {
	/** The Metagame Scopes it offers; any other reads every Player. */
	scopes: readonly MetagameScope[];
	/**
	 * Whether it reads standings: win rate, average position, points and the
	 * Conversion Target. Without them it reads participation only.
	 */
	readsStandings: boolean;
}

export interface GameConfig {
	label: string;
	defaults: FeatureMatchDefaults;
	counterTypes: CounterTypeConfig[];
	startingTurnNumber: number;
	startingHandSize: number;
	playerIdentityLabel: string;
	tracks: FeatureMatchStateTracking;
	metagame: MetagameRules;
}

// Game-specific player data (discriminated union on `type`)
export interface MtgPlayerGameData {
	type: 'mtg';
	deckName?: string | null;
	deckColors?: string | null;
	/**
	 * A Commander Event Seat's one or two Commanders (ADR-0087). The server
	 * writes the Seat's deck name and colours from them.
	 */
	commanders?: Commander[] | null;
}

/**
 * One of a Seat's Commanders: one printing of a Magic: The Gathering card,
 * as its operator picked it (ADR-0087).
 */
export interface Commander {
	/** The printing, by its Scryfall id. */
	scryfallId: string;
	/** The card's name; its front face's, for a card with two. */
	name: string;
	/** Colour identity letters in WUBRG order; empty for a colourless card. */
	colorIdentity: string;
	setCode: string;
	collectorNumber: string;
}

/**
 * A Feature Match Slot side's Leader: one Leader card from the card catalogue,
 * imaged by its standard Printing. The side stores only its number and every
 * read fills in the rest from the catalogue (ADR-0074); a save is trusted for
 * the number alone.
 */
export interface OpLeader {
	number: string;
	name: string;
	/** One colour, or two for a dual-colour Leader. */
	colors: OpCardColor[];
	imageUrl: string;
}

export interface OpPlayerGameData {
	type: 'op';
	leader?: OpLeader | null;
	/**
	 * A Feature Match Slot side's Deck List, by reference: it travels with the
	 * side's player data, so it moves with its player on a swap (ADR-0057).
	 * The server owns its Mainboard count.
	 */
	featureMatchDeckList?: FeatureMatchDeckListReference | null;
	/**
	 * A Player's Deck List, by reference (ADR-0074): written only by the OP
	 * Deck List write. Its Leader is the Player's Leader.
	 */
	deckList?: OpPlayerDeckListReference | null;
}

export type PlayerGameData = MtgPlayerGameData | OpPlayerGameData;
