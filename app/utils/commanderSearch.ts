import type { Commander } from '~~/shared/types/game';
import type { ScryfallCommanderCard } from '~~/shared/utils/commander';
import { commanderOfScryfallCard } from '~~/shared/utils/commander';

/**
 * Scryfall's card search, as a Seat's Commander picker asks it (ADR-0086): any
 * paper Magic: The Gathering card may be a Commander, and each answer is one printing.
 */

const SCRYFALL_SEARCH_URL = 'https://api.scryfall.com/cards/search';
const SCRYFALL_CLIENT_TIMEOUT_MS = 10_000;
/** Scryfall asks for at least this much of a name before a search. */
export const COMMANDER_SEARCH_MIN_LENGTH = 3;

async function search(query: Record<string, string>, signal?: AbortSignal): Promise<Commander[]> {
	try {
		const answer = await $fetch<{ data: ScryfallCommanderCard[] }>(SCRYFALL_SEARCH_URL, {
			query,
			signal,
			timeout: SCRYFALL_CLIENT_TIMEOUT_MS,
		});
		return answer.data.map(commanderOfScryfallCard);
	}
	catch (error) {
		// Scryfall answers a search that matches no card with 404.
		if ((error as { statusCode?: number })?.statusCode === 404)
			return [];
		throw error;
	}
}

/** The cards whose name the text is part of, each as its default printing. */
export function searchCommanderCards(text: string, signal?: AbortSignal): Promise<Commander[]> {
	return search({ q: `${text} game:paper`, unique: 'cards' }, signal);
}

/** Every paper printing of the card of exactly this name, newest first. */
export function searchCommanderPrintings(name: string, signal?: AbortSignal): Promise<Commander[]> {
	return search({ q: `!"${name}" game:paper`, unique: 'prints', order: 'released' }, signal);
}
