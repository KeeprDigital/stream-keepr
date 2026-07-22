import type { CreateFeatureMatchAssignmentInput, FeatureMatchAssignment, UpdateFeatureMatchAssignmentInput } from '~/types';
import { useEventDataFetch, useEventDataResource } from '~/modules/event-data/client';

export function useFeatureMatchAssignmentRepository() {
	const eventData = useEventDataFetch();
	const base = useEventDataResource<FeatureMatchAssignment, CreateFeatureMatchAssignmentInput, UpdateFeatureMatchAssignmentInput>({
		resourcePath: 'feature-match-assignments',
		eventScoped: true,
		includeHeaders: true,
		responseKey: 'featureMatchAssignments',
	});

	const listByRound = async (eventId: number, roundId: number): Promise<FeatureMatchAssignment[]> => {
		const response = await eventData.command<{ featureMatchAssignments: FeatureMatchAssignment[] }>(
			{ eventId, resourcePath: 'feature-match-assignments' },
			{ method: 'GET', query: { roundId }, includeHeaders: false },
		);
		return response.featureMatchAssignments;
	};

	return {
		list: base.list,
		listByRound,
		create: base.create,
		update: base.update,
		remove: base.remove,
	};
}
