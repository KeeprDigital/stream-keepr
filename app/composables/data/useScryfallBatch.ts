import type { ScryfallCard, ScryfallList } from '@scryfall/api-types';
import type { DeckListCard } from '~~/shared/types/deckList';
import type { DeckListCardWithData } from '~/types/card/deckList';
import type { MtgCard } from '~/types/card/mtg';
import { cardParser } from '~~/shared/utils/card/parsers';
import { deriveDeckCounterTypesFromScryfallCard } from '~~/shared/utils/deckCounters';
import { deriveDeckTokensFromScryfallCard } from '~~/shared/utils/deckTokens';

const SCRYFALL_COLLECTION_BATCH_SIZE = 75;
const SCRYFALL_FUZZY_CONCURRENCY = 4;
const SCRYFALL_CLIENT_TIMEOUT_MS = 10_000;

/**
 * Backoff before each retry of one transient Scryfall failure. The length is the
 * bound: a request is attempted at most one more time than there are delays.
 */
const SCRYFALL_RETRY_DELAYS_MS = [500, 2000];

/**
 * What one batch fetch resolved, and whether it resolved everything it could.
 *
 * `degraded` is true when a transient Scryfall failure survived every retry, so
 * cards that should have resolved are missing from `cards` and the caller is
 * rendering placeholders a later re-fetch could fill in. A fuzzy-search 404 is a
 * genuine not-found — the placeholder is the correct rendering — and never marks
 * the result degraded.
 */
export interface ScryfallCardFetchResult {
	cards: Map<string, MtgCard>;
	degraded: boolean;
}

function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function isNotFound(error: unknown): boolean {
	const candidate = error as { statusCode?: number; status?: number; response?: { status?: number } } | null;
	return candidate?.statusCode === 404 || candidate?.status === 404 || candidate?.response?.status === 404;
}

async function fetchWithRetry<T>(request: () => Promise<T>, isPermanent?: (error: unknown) => boolean): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await request();
		}
		catch (error) {
			if (isPermanent?.(error) || attempt >= SCRYFALL_RETRY_DELAYS_MS.length) {
				throw error;
			}
			await delay(SCRYFALL_RETRY_DELAYS_MS[attempt]!);
		}
	}
}

/**
 * Composable for batch-fetching Scryfall card data.
 * Shared between the card store and overlay DeckDisplay component.
 */
export function useScryfallBatch() {
	/**
	 * Batch fetch Scryfall card data for a list of deck list cards.
	 * Cards with scryfallId use the collection endpoint (batched in 75s).
	 * Cards without scryfallId fall back to fuzzy name search.
	 * Returns a map of scryfallId -> MtgCard, plus a name-based index
	 * for cards that were resolved by fuzzy search (no scryfallId), and
	 * whether any transient failure exhausted its retries (#465).
	 */
	async function fetchScryfallCards(allCards: Array<{ name: string; scryfallId: string | null }>): Promise<ScryfallCardFetchResult> {
		const cardsWithIds = allCards.filter(c => c.scryfallId);
		const cardsWithoutIds = allCards.filter(c => !c.scryfallId);
		const cardDataMap = new Map<string, MtgCard>();
		let degraded = false;

		// Batch fetch by scryfall ID (collection endpoint, max 75 per request)
		if (cardsWithIds.length > 0) {
			const uniqueIds = [...new Set(cardsWithIds.map(c => c.scryfallId!))];
			const batches: Array<{ id: string }[]> = [];
			for (let i = 0; i < uniqueIds.length; i += SCRYFALL_COLLECTION_BATCH_SIZE) {
				batches.push(uniqueIds.slice(i, i + SCRYFALL_COLLECTION_BATCH_SIZE).map(id => ({ id })));
			}

			for (const batch of batches) {
				try {
					const response = await fetchWithRetry(() => $fetch<ScryfallList.Cards>(
						'https://api.scryfall.com/cards/collection',
						{ method: 'POST', body: { identifiers: batch }, timeout: SCRYFALL_CLIENT_TIMEOUT_MS },
					));
					for (const card of response.data) {
						cardDataMap.set(card.id, {
							...cardParser(card),
							deckCounterTypes: deriveDeckCounterTypesFromScryfallCard(card),
							deckTokens: deriveDeckTokensFromScryfallCard(card),
						});
					}
				}
				catch {
					// Retries exhausted: continue with other batches, but say so —
					// this batch's cards will render as placeholders until a re-fetch.
					degraded = true;
				}
			}
		}

		// Fuzzy name search for cards without IDs
		// Store results keyed by both scryfall ID and the original card name
		// so buildDeckListArrays can resolve them via the name-based key
		const uniqueNames = [...new Set(cardsWithoutIds.map(c => c.name))];
		for (let index = 0; index < uniqueNames.length; index += SCRYFALL_FUZZY_CONCURRENCY) {
			const chunk = uniqueNames.slice(index, index + SCRYFALL_FUZZY_CONCURRENCY);
			await Promise.all(chunk.map(async (name) => {
				try {
					const response = await fetchWithRetry(() => $fetch<ScryfallCard.Any>(
						'https://api.scryfall.com/cards/named',
						{ query: { fuzzy: name }, timeout: SCRYFALL_CLIENT_TIMEOUT_MS },
					), isNotFound);
					const parsed = {
						...cardParser(response),
						deckCounterTypes: deriveDeckCounterTypesFromScryfallCard(response),
						deckTokens: deriveDeckTokensFromScryfallCard(response),
					};
					cardDataMap.set(response.id, parsed);
					// Also key by the original card name (lowercased) so cards
					// without a scryfallId can still be enriched during display
					cardDataMap.set(`name:${name.toLowerCase()}`, parsed);
				}
				catch (error) {
					// A 404 is a card that genuinely does not exist: the placeholder
					// is the correct rendering. Anything else is a transient failure
					// that exhausted its retries.
					if (!isNotFound(error)) {
						degraded = true;
					}
				}
			}));
		}

		return { cards: cardDataMap, degraded };
	}

	/**
	 * Build DeckListCardWithData arrays (mainboard/sideboard) from a deck list and card data map.
	 */
	function buildDeckListArrays(
		cards: DeckListCard[],
		cardDataMap: Map<string, MtgCard>,
	): { mainboard: DeckListCardWithData[]; sideboard: DeckListCardWithData[] } {
		const enrichCard = (card: DeckListCard): DeckListCardWithData => ({
			...card,
			mtgCard: card.scryfallId
				? cardDataMap.get(card.scryfallId) ?? null
				// Fall back to name-based lookup for cards without a scryfallId
				// (e.g. MDFCs where the server-side Scryfall lookup had a key mismatch)
				: cardDataMap.get(`name:${card.name.toLowerCase()}`) ?? null,
		});

		return {
			mainboard: cards.filter(c => c.compartment === 'mainboard').map(enrichCard),
			sideboard: cards.filter(c => c.compartment === 'sideboard').map(enrichCard),
		};
	}

	return {
		fetchScryfallCards,
		buildDeckListArrays,
	};
}
