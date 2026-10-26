import type { ScreenCardState, ScreenCardWriteResult } from '~~/shared/types/card/mtg';
import type { MtgCard } from '~/types/card/mtg';
import { useEventDataFetch } from '~/modules/event-data/client';

export function useCardRepository() {
	const eventData = useEventDataFetch();

	/** Save a Card; the answer carries the Card revision it committed (#734). */
	const saveScreenCard = async (eventId: number, screenId: number, card: MtgCard) => {
		return await eventData.command<ScreenCardWriteResult, MtgCard>(
			{
				eventId,
				resourcePath: 'screens',
				resourceId: screenId,
				suffix: 'card',
			},
			{ method: 'PUT', body: card },
		);
	};

	/** The Screen's Card with the Card revision it was read at (#734). */
	const getScreenCard = async (eventId: number, screenId: number): Promise<ScreenCardState> => {
		return await $fetch<ScreenCardState>(eventData.path({
			eventId,
			resourcePath: 'screens',
			resourceId: screenId,
			suffix: 'card',
		}));
	};

	/** The operator's Clear; the answer carries the Card revision it committed (#734). */
	const deleteScreenCard = async (eventId: number, screenId: number) => {
		return await eventData.command<ScreenCardWriteResult>(
			{
				eventId,
				resourcePath: 'screens',
				resourceId: screenId,
				suffix: 'card',
			},
			{ method: 'DELETE' },
		);
	};

	return {
		saveScreenCard,
		getScreenCard,
		deleteScreenCard,
	};
}
