import type { Commander } from '~~/shared/types/game';
import type { ScryfallCommanderCard } from '~~/shared/utils/commander';
import { commanderOfScryfallCard } from '~~/shared/utils/commander';

/**
 * Scryfall's card search, as a Seat's Commander picker asks it (ADR-0087): any
 * paper Magic: The Gathering card may be a Commander, and each answer is one printing.
 */

const SCRYFALL_CARD_URL = 'https://api.scryfall.com/cards';
const SCRYFALL_SEARCH_URL = `${SCRYFALL_CARD_URL}/search`;
const SCRYFALL_CLIENT_TIMEOUT_MS = 10_000;
/** Scryfall asks for at least this much of a name before a search. */
export const COMMANDER_SEARCH_MIN_LENGTH = 3;

/** The fields of a Scryfall card that say which card a printing is of. */
interface ScryfallCardIdentity {
	oracle_id?: string | null;
	card_faces?: { oracle_id?: string | null }[];
}

async function search(query: Record<string, string>): Promise<Commander[]> {
	try {
		const answer = await $fetch<{ data: ScryfallCommanderCard[] }>(SCRYFALL_SEARCH_URL, {
			query,
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
export function searchCommanderCards(text: string): Promise<Commander[]> {
	return search({ q: `${text} game:paper`, unique: 'cards' });
}

/**
 * Every paper printing of a held Commander's card, newest first. The card is
 * found by its oracle id, read from the printing held (a two-faced card may
 * carry it on its faces): a name can hold quotes no search phrase survives.
 */
export async function searchCommanderPrintings(commander: Commander): Promise<Commander[]> {
	const card = await $fetch<ScryfallCardIdentity>(`${SCRYFALL_CARD_URL}/${commander.scryfallId}`, {
		timeout: SCRYFALL_CLIENT_TIMEOUT_MS,
	});
	const oracleId = card.oracle_id ?? card.card_faces?.[0]?.oracle_id;
	return oracleId
		? search({ q: `oracleid:${oracleId} game:paper`, unique: 'prints', order: 'released' })
		: [];
}
