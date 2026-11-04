import type { OpUnresolvedDeckCard, OpUnresolvedDeckCardAnswer } from '~~/shared/types/opUnresolvedDeckCard';
import { useEventDataFetch } from '~/modules/event-data/client';

/** A One Piece Card Game Event's Unresolved Deck Cards (ADR-0074): listed, retried and resolved by card number. */
export function useOpUnresolvedDeckCardRepository() {
	const eventData = useEventDataFetch();
	const path = (eventId: number, number?: string, suffix?: string) => ({
		eventId,
		resourcePath: 'op-unresolved-deck-cards',
		resourceId: number,
		suffix,
	});

	const list = async (eventId: number) =>
		await eventData.command<OpUnresolvedDeckCard[]>(path(eventId), { method: 'GET', includeHeaders: false });

	const retry = async (eventId: number, number: string) =>
		await eventData.command<OpUnresolvedDeckCardAnswer>(path(eventId, number, 'retry'), { method: 'POST' });

	/** Resolves the number to the card picked from a bandai-keepr search. */
	const resolve = async (eventId: number, number: string, cardNumber: string) =>
		await eventData.command<OpUnresolvedDeckCardAnswer, { cardNumber: string }>(
			path(eventId, number),
			{
				method: 'PUT',
				body: { cardNumber },
			},
		);

	return { list, retry, resolve };
}
