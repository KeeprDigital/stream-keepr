import type { OpCardCategory, OpCardColor, OpCardLookupAnswer, OpCardSearchAnswer } from '~~/shared/types/card/op';
import { buildEventDataPath } from '~/modules/event-data/client';

export interface OpCardSearchParams {
	q?: string;
	/** Part of a card's name or card number, as typed: `luf`, `monkey d luf`, `op01-0`. */
	name?: string;
	number?: string;
	color?: OpCardColor;
	category?: OpCardCategory;
	/** At most 250 cards a page; bandai-keepr's default page is 60. */
	limit?: number;
	offset?: number;
}

/** One Piece card data, through the Event's bandai-keepr proxy (ADR-0057). */
export function useOpCardRepository() {
	const searchCards = async (eventId: number, query: OpCardSearchParams, signal?: AbortSignal) =>
		await $fetch<OpCardSearchAnswer>(buildEventDataPath({ eventId, resourcePath: 'op-cards' }), { query, signal });

	const lookupCard = async (eventId: number, number: string, signal?: AbortSignal) =>
		await $fetch<OpCardLookupAnswer>(buildEventDataPath({ eventId, resourcePath: 'op-cards', resourceId: number }), { signal });

	return { searchCards, lookupCard };
}
