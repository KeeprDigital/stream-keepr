import { vi } from 'vitest';

/**
 * `useScryfallBatch` with its card data fetch faked: every printing asked for
 * by Scryfall id answers `cardOf(id)`, and nothing is degraded. The rest is
 * the real composable. Pass it to `mockNuxtImport('useScryfallBatch', …)`.
 */
export async function scryfallBatchAnswering(cardOf: (scryfallId: string) => unknown) {
	const actual = await vi.importActual<typeof import('~/composables/data/useScryfallBatch')>('~/composables/data/useScryfallBatch');
	return () => ({
		...actual.useScryfallBatch(),
		fetchScryfallCards: async (cards: Array<{ scryfallId: string | null }>) => ({
			cards: new Map(cards.flatMap(card => card.scryfallId
				? [
						[
							card.scryfallId,
							cardOf(card.scryfallId),
						],
					]
				: [])),
			degraded: false,
		}),
	});
}
