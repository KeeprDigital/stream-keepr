import type { PlayerSide, Seat } from '~~/shared/types/enums';
import type {
	CommanderDeckListPreviewAnswer,
	FeatureMatchDeckListPreviewAnswer,
	SaveCommanderDeckListAnswer,
	SavedCommanderDeckList,
	SavedFeatureMatchDeckList,
	SaveFeatureMatchDeckListAnswer,
} from '~~/shared/types/featureMatchDeckList';
import type { FeatureMatch } from '~/types';
import { useEventDataFetch } from '~/modules/event-data/client';

/** Feature Match Deck Lists: pasted per Seat on a One Piece Event (ADR-0057) or a Commander Event (ADR-0087). */
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
		await eventData.command<SaveFeatureMatchDeckListAnswer<FeatureMatch>, { side: PlayerSide; text: string }>(
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

	/** A Commander Seat's paste as it would be saved, or the lines that refuse it. */
	const previewCommander = async (eventId: number, slotId: number, text: string) =>
		await eventData.command<CommanderDeckListPreviewAnswer, { text: string }>(
			path(eventId, slotId, 'commander-deck-lists/preview'),
			{
				method: 'POST',
				body: { text },
				includeHeaders: false,
			},
		);

	/** `commanders` are the printings confirmed as the Seat's Commanders, by Scryfall id. */
	const saveCommander = async (eventId: number, slotId: number, seat: Seat, text: string, commanders: string[]) =>
		await eventData.command<SaveCommanderDeckListAnswer<FeatureMatch>, { seat: Seat; text: string; commanders: string[] }>(
			path(eventId, slotId, 'commander-deck-lists'),
			{
				method: 'POST',
				body: { seat, text, commanders },
			},
		);

	const readCommander = async (eventId: number, slotId: number, deckListId: number) =>
		await eventData.command<SavedCommanderDeckList>(
			path(eventId, slotId, `commander-deck-lists/${deckListId}`),
			{ method: 'GET', includeHeaders: false },
		);

	return { preview, save, read, previewCommander, saveCommander, readCommander };
}
