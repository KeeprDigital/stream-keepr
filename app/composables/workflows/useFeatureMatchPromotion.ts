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
 * Assignment changes to local Event Data stores without broad reloads. Each
 * returned Slot is a write's answer, so its Session passes the Live State
 * Follower's command-result decision: an answer overtaken by a newer
 * promotion or clearing of that Slot is refused, Assignment included.
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
		// The answer belongs to the Event Lifetimes this promotion began in: one that
		// arrives after the operator moved on — even back to this Event — is still
		// returned, but changes neither store (ADR-0024).
		const slotsFlight = featureMatchStore.currentLifetime();
		const assignmentsFlight = assignmentStore.currentLifetime();
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

		// An answer overtaken by a newer promotion or clearing of the promoted Slot
		// carries an Assignment that promotion has already moved on.
		let promotedSlotCurrent = true;
		if (slotsFlight.current) {
			for (const featureMatch of result.clearedSlots)
				featureMatchStore.applySavedSlot(featureMatch);
			promotedSlotCurrent = featureMatchStore.applySavedSlot(result.promotedSlot);
		}

		if (promotedSlotCurrent && assignmentsFlight.current && assignmentStore.currentEventId === eventId && assignmentStore.assignmentsByRound.has(roundId))
			assignmentStore.applySavedAssignment(result.assignment);

		return result;
	}

	return {
		promote,
	};
}
