import type { MtgCard } from '~/types/card/mtg';
import { useEventDataFetch } from '~/modules/event-data/client';

export function useCardRepository() {
	const eventData = useEventDataFetch();

	const saveScreenCard = async (eventId: number, screenId: number, card: MtgCard) => {
		return await eventData.command(
			{ eventId, resourcePath: 'screens', resourceId: screenId, suffix: 'card' },
			{ method: 'PUT', body: card },
		);
	};

	const getScreenCard = async (eventId: number, screenId: number): Promise<MtgCard | null> => {
		return await $fetch<MtgCard | null>(eventData.path({ eventId, resourcePath: 'screens', resourceId: screenId, suffix: 'card' }));
	};

	const deleteScreenCard = async (eventId: number, screenId: number) => {
		return await eventData.command(
			{ eventId, resourcePath: 'screens', resourceId: screenId, suffix: 'card' },
			{ method: 'DELETE' },
		);
	};

	return {
		saveScreenCard,
		getScreenCard,
		deleteScreenCard,
	};
}
