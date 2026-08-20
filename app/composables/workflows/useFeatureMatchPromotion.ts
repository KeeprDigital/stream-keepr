import type { FeatureMatchNoteDiscardConfirmation, FeatureMatchPromotionResponse } from '~~/shared/api';
import { LazyFeatureMatchNoteDiscardModal } from '#components';
import { featureMatchNoteDiscardConflict } from '~/utils/featureMatchNoteDiscardConflict';

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
	const overlay = useOverlay();

	async function promote({
		eventId,
		roundId,
		slotId,
		matchId,
	}: PromoteFeatureMatchInput): Promise<FeatureMatchPromotionResponse | undefined> {
		let confirmedNoteDiscards: FeatureMatchNoteDiscardConfirmation[] | undefined;
		let result: FeatureMatchPromotionResponse;
		while (true) {
			try {
				result = confirmedNoteDiscards
					? await featureMatchRepo.promoteMatch(eventId, slotId, matchId, confirmedNoteDiscards)
					: await featureMatchRepo.promoteMatch(eventId, slotId, matchId);
				break;
			}
			catch (cause) {
				const conflict = featureMatchNoteDiscardConflict(cause);
				if (!conflict)
					throw cause;
				const modal = overlay.create(LazyFeatureMatchNoteDiscardModal);
				const confirmed = await modal.open({ assignments: conflict.assignments }).result;
				if (!confirmed)
					return undefined;
				confirmedNoteDiscards = conflict.assignments.map(({ assignment }) => ({
					assignmentId: assignment.id,
					updatedAt: new Date(assignment.updatedAt),
				}));
			}
		}

		for (const featureMatch of result.clearedSlots)
			featureMatchStore.applyRemoteUpdated({ eventId, timestamp: Date.now(), featureMatch });
		featureMatchStore.applyRemoteUpdated({ eventId, timestamp: Date.now(), featureMatch: result.promotedSlot });

		if (assignmentStore.currentEventId === eventId && assignmentStore.assignmentsByRound.has(roundId))
			assignmentStore.applySavedAssignment(result.assignment);

		return result;
	}

	return {
		promote,
	};
}
