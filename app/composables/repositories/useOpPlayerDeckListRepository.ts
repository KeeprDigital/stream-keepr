import type { SavedOpPlayerDeckList, WriteOpPlayerDeckListAnswer } from '~~/shared/types/opDeckList';
import type { Player } from '~/types';
import { useEventDataFetch } from '~/modules/event-data/client';

/** A One Piece Card Game Player's Deck List (ADR-0074), read and written by hand, or taken back from the last TCG+ Import. */
export function useOpPlayerDeckListRepository() {
	const eventData = useEventDataFetch();
	const path = (eventId: number, playerId: number) => ({
		eventId,
		resourcePath: 'players',
		resourceId: playerId,
		suffix: 'deck-list',
	});

	const read = async (eventId: number, playerId: number) =>
		await eventData.command<{ deckList: SavedOpPlayerDeckList | null }>(
			path(eventId, playerId),
			{ method: 'GET', includeHeaders: false },
		);

	/** Paste text, and the Leader picked, which a pasted Leader line overrules. */
	const write = async (eventId: number, playerId: number, text: string, leaderNumber: string | null) =>
		await eventData.command<WriteOpPlayerDeckListAnswer<Player>, { text: string; leaderNumber: string | null }>(
			path(eventId, playerId),
			{
				method: 'PUT',
				body: { text, leaderNumber },
			},
		);

	/** Drops a hand edit for the Deck List the last TCG+ Import brought the Player. */
	const takeImported = async (eventId: number, playerId: number) =>
		await eventData.command<WriteOpPlayerDeckListAnswer<Player>>(
			{
				...path(eventId, playerId),
				suffix: 'deck-list/use-imported',
			},
			{ method: 'POST' },
		);

	return { read, write, takeImported };
}
