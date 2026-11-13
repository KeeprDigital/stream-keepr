import type { Commander, MtgPlayerGameData } from '../types/game';

/** A Seat holds one or two Commanders (ADR-0086). */
export const MAX_SEAT_COMMANDERS = 2;

const COLOUR_ORDER = 'WUBRG';
/** The colours of a deck whose Commanders have no colour identity. */
const COLOURLESS = 'C';

/** Colour identity letters, each once, in WUBRG order. */
export function orderedColourIdentity(letters: Iterable<string>): string {
	const held = new Set(letters);
	return [...COLOUR_ORDER].filter(letter => held.has(letter)).join('');
}

/**
 * A Seat's deck as a broadcast names it: its Commanders' names, and their
 * colour identity together (ADR-0086). A Seat with no Commander has neither.
 */
export function commanderDeckIdentity(commanders: readonly Commander[]): Required<Pick<MtgPlayerGameData, 'deckName' | 'deckColors'>> {
	if (commanders.length === 0)
		return { deckName: null, deckColors: null };
	return {
		deckName: commanders.map(commander => commander.name).join(' / '),
		deckColors: orderedColourIdentity(commanders.flatMap(commander => [...commander.colorIdentity])) || COLOURLESS,
	};
}

/** The fields of a Scryfall card a Commander is read from. */
export interface ScryfallCommanderCard {
	id: string;
	name: string;
	color_identity?: readonly string[] | null;
	set: string;
	collector_number: string;
}

/** The Commander one Scryfall card is: that printing, named by its front face. */
export function commanderOfScryfallCard(card: ScryfallCommanderCard): Commander {
	return {
		scryfallId: card.id,
		name: card.name.split(' // ')[0]!,
		colorIdentity: orderedColourIdentity(card.color_identity ?? []),
		setCode: card.set,
		collectorNumber: card.collector_number,
	};
}
