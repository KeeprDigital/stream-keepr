import type { PlayerSide } from '~~/shared/types/enums';
import type { FeatureMatchDeckListPreviewAnswer, SavedFeatureMatchDeckList } from '~~/shared/types/featureMatchDeckList';
import type { FeatureMatch } from '~/types';
import { useEventDataFetch } from '~/modules/event-data/client';

export type SaveFeatureMatchDeckListAnswer
	= | { available: false }
		| { available: true; deckList: SavedFeatureMatchDeckList; featureMatch: FeatureMatch };

/** Feature Match Deck Lists: pasted per Slot side on a One Piece Event (ADR-0057). */
export function useFeatureMatchDeckListRepository() {
	const eventData = useEventDataFetch();
	const path = (eventId: number, slotId: number, suffix: string) => ({
		eventId,
		resourcePath: 'feature-match-slots',
		resourceId: slotId,
		suffix,
	});

	const preview = async (eventId: number, slotId: number, text: string) =>
		await eventData.command<FeatureMatchDeckListPreviewAnswer, { text: string }>(
			path(eventId, slotId, 'deck-lists/preview'),
			{
				method: 'POST',
				body: { text },
				includeHeaders: false,
			},
		);

	/** `side` is the Slot's own side: a Session swap never moves a Deck List between Slot sides. */
	const save = async (eventId: number, slotId: number, side: PlayerSide, text: string) =>
		await eventData.command<SaveFeatureMatchDeckListAnswer, { side: PlayerSide; text: string }>(
			path(eventId, slotId, 'deck-lists'),
			{
				method: 'POST',
				body: { side, text },
			},
		);

	const read = async (eventId: number, slotId: number, deckListId: number) =>
		await eventData.command<SavedFeatureMatchDeckList>(
			path(eventId, slotId, `deck-lists/${deckListId}`),
			{ method: 'GET', includeHeaders: false },
		);

	return { preview, save, read };
}
