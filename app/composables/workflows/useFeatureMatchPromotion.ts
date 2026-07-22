import type { FeatureMatchPromotionResponse } from '~/types';

interface PromoteFeatureMatchInput {
	eventId: number;
	roundId: number;
	slotId: number;
	matchId: number;
}

/**
 * Client-side Feature Match Slot Promotion workflow.
 *
 * Calls the server-side promotion seam and applies the returned Slot and
 * Assignment changes to local Event Data stores without broad reloads.
 */
export function useFeatureMatchPromotion() {
	const featureMatchRepo = useFeatureMatchRepository();
	const featureMatchStore = useFeatureMatchStore();
	const assignmentStore = useFeatureMatchAssignmentStore();

	async function promote({
		eventId,
		roundId,
		slotId,
		matchId,
	}: PromoteFeatureMatchInput): Promise<FeatureMatchPromotionResponse> {
		const result = await featureMatchRepo.promoteMatch(eventId, slotId, matchId);

		for (const featureMatch of result.clearedSlots)
			featureMatchStore.applyRemoteUpdated({ eventId, timestamp: Date.now(), featureMatch });
		featureMatchStore.applyRemoteUpdated({ eventId, timestamp: Date.now(), featureMatch: result.promotedSlot });

		if (assignmentStore.currentEventId === eventId && assignmentStore.loadedRoundId === roundId)
			assignmentStore.applySavedAssignment(result.assignment);

		return result;
	}

	return {
		promote,
	};
}
