import type {
	CreateMatchInput,
	Match,
	UpdateMatchInput,
} from '~/types';
import { useEventDataResource } from '~/modules/event-data/client';

export function useMatchRepository() {
	const base = useEventDataResource<Match, CreateMatchInput, UpdateMatchInput>({
		resourcePath: 'matches',
		eventScoped: true,
		includeHeaders: true,
	});

	const list = async (eventId: number, roundId?: number): Promise<Match[]> => {
		if (roundId) {
			const response = await $fetch<{ matches: Match[] }>(`/api/events/${eventId}/matches`, {
				query: { roundId },
			});
			return response.matches;
		}
		return base.list(eventId);
	};

	return {
		list,
		getById: base.getById,
		create: base.create,
		update: base.update,
		remove: base.remove,
	};
}
