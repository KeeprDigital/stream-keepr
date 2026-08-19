import type {
	CreateFeatureMatchInput,
	FeatureMatch,
	FeatureMatchNoteDiscardConfirmation,
	FeatureMatchPromotionResponse,
	UpdateFeatureMatchInput,
} from '~/types';
import { useEventDataFetch, useEventDataResource } from '~/modules/event-data/client';

export function useFeatureMatchRepository() {
	const base = useEventDataResource<FeatureMatch, CreateFeatureMatchInput, UpdateFeatureMatchInput>({
		resourcePath: 'feature-match-slots',
		eventScoped: true,
		includeHeaders: true,
		responseKey: 'featureMatchSlots',
	});
	const eventData = useEventDataFetch();

	const update = async (eventId: number, slotId: number, updates: UpdateFeatureMatchInput): Promise<FeatureMatch> => {
		return await eventData.command<FeatureMatch, UpdateFeatureMatchInput>(
			{ eventId, resourcePath: 'feature-match-slots', resourceId: slotId, suffix: 'setup' },
			{ method: 'PATCH', body: updates },
		);
	};

	const reorder = async (eventId: number, slotId: number, direction: 'up' | 'down'): Promise<void> => {
		await eventData.command<void, { slotId: number; direction: 'up' | 'down' }>(
			{ eventId, resourcePath: 'feature-match-slots', suffix: 'reorder' },
			{ method: 'PATCH', body: { slotId, direction } },
		);
	};

	const promoteMatch = async (
		eventId: number,
		slotId: number,
		matchId: number,
		confirmedNoteDiscards?: FeatureMatchNoteDiscardConfirmation[],
	): Promise<FeatureMatchPromotionResponse> => {
		return await eventData.command<FeatureMatchPromotionResponse, { matchId: number; confirmedNoteDiscards?: FeatureMatchNoteDiscardConfirmation[] }>(
			{ eventId, resourcePath: 'feature-match-slots', resourceId: slotId, suffix: 'promote' },
			{ method: 'POST', body: { matchId, ...(confirmedNoteDiscards ? { confirmedNoteDiscards } : {}) } },
		);
	};

	return {
		list: base.list,
		getById: base.getById,
		create: base.create,
		update,
		remove: base.remove,
		reorder,
		promoteMatch,
	};
}
