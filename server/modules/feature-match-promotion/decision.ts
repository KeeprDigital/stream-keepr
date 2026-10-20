import type { DbFeatureMatch, DbFeatureMatchAssignment, DbFeatureMatchSession } from '~~/server/db/schema';
import type { EventDataMessage } from '~~/server/modules/event-data-publication';
import type { FeatureMatchPromotionResponse } from '~~/shared/api';
import { mapFeatureMatchSessionToStarted, mapFeatureMatchToResponse } from '~~/server/mappers/featureMatch';
import { mapFeatureMatchAssignmentToResponse } from '~~/server/mappers/featureMatchAssignment';

type SlotRead = DbFeatureMatch & { activeSession?: DbFeatureMatchSession | null };

/** What a promotion read before its batch, and what its plan wrote. */
export interface PromotionPreState {
	slotId: number;
	matchId: number;
	/** The Match's own Assignment this Round, which the promotion continues. */
	continuedAssignment?: DbFeatureMatchAssignment;
	/** A different Match's Assignment to this Slot, which the promotion ends. */
	displacedAssignment?: DbFeatureMatchAssignment;
	/** Every Slot the plan cleared of the Match, in plan order. */
	clearedSlotIds: readonly number[];
}

/** Read once the batch has committed, before anything is published. */
export interface PromotionCommittedReads {
	slot: SlotRead | undefined;
	/** The Round's Assignment to the promoted Slot. */
	assignment: DbFeatureMatchAssignment | undefined;
}

/** Read after the reverse sync, so what is published carries its snapshot. */
export interface PromotionCurrentReads {
	/** The Event's Slots, each with its active Session. */
	slots: readonly SlotRead[];
	/** The promotion's Assignment, wherever it is now. */
	assignment: DbFeatureMatchAssignment | undefined;
	/** The Sessions the promotion's commit opened that are still active. */
	openedSessions: readonly DbFeatureMatchSession[];
}

interface PromotionFailed {
	outcome: 'failed';
	message: string;
}

export interface PromotionPublication {
	/**
	 * `won-then-moved`: another promotion moved the Match off after this one's
	 * outcome was decided. That history is a serial "promoted, then moved" (#575),
	 * so this one still stands and is answered with the state as it is now.
	 */
	outcome: 'won' | 'won-then-moved';
	/** Everything the promotion announces, in order. */
	messages: EventDataMessage[];
	response: FeatureMatchPromotionResponse;
}

export type PromotionDecision
	= | { outcome: 'lost' }
		| PromotionFailed
		| {
			outcome: 'standing';
			/** The Assignment the promotion committed. */
			assignment: DbFeatureMatchAssignment;
			/** The only way to the messages a promotion may publish. */
			describe: (current: PromotionCurrentReads) => PromotionPublication | PromotionFailed;
		};

/**
 * Decide a Feature Match Slot Promotion's outcome from what it read before its
 * batch and right after it committed.
 *
 * The batch committed, so the Slot did hold the Match. If another promotion has
 * moved it off since, this one lost: its operator is told so, and no peer may be
 * shown any of it, including the new Sessions of the Slots it cleared (#576,
 * ADR-0029). The Assignment is read before the Slot, so a move that carried the
 * Assignment elsewhere shows as a lost promotion rather than a missing Assignment.
 *
 * A standing promotion describes its publication only from later reads. That is
 * the shape of "decide the outcome before publishing" (#577): there is no message
 * to publish without a standing decision to describe it.
 */
export function decidePromotion(pre: PromotionPreState, committed: PromotionCommittedReads): PromotionDecision {
	if (!committed.slot)
		return { outcome: 'failed', message: 'Failed to retrieve updated feature match slot' };
	if (committed.slot.matchId !== pre.matchId)
		return { outcome: 'lost' };
	const assignment = committed.assignment;
	if (!assignment)
		return { outcome: 'failed', message: 'Failed to save feature match assignment' };

	return {
		outcome: 'standing',
		assignment,
		describe: (current) => {
			const slotsById = new Map(current.slots.map(slot => [slot.id, slot]));
			const promotedSlot = slotsById.get(pre.slotId);
			if (!promotedSlot)
				return { outcome: 'failed', message: 'Failed to retrieve updated feature match slot' };

			const clearedSlots = pre.clearedSlotIds.flatMap((id) => {
				const slot = slotsById.get(id);
				return slot ? [mapFeatureMatchToResponse(slot)] : [];
			});
			const promoted = mapFeatureMatchToResponse(promotedSlot);
			const committedAssignment = mapFeatureMatchAssignmentToResponse(assignment);
			const displaced = pre.displacedAssignment && pre.displacedAssignment.id !== assignment.id
				? pre.displacedAssignment
				: undefined;

			const messages: EventDataMessage[] = [
				...current.openedSessions.map(session => ({
					type: 'featureMatchSession:eventApplied' as const,
					payload: mapFeatureMatchSessionToStarted(session),
				})),
				// What this promotion committed, which peers learn even if the Match
				// has moved on since: the move announces itself.
				pre.continuedAssignment
					? { type: 'featureMatchAssignment:updated', payload: { featureMatchAssignment: committedAssignment } }
					: { type: 'featureMatchAssignment:created', payload: { featureMatchAssignment: committedAssignment } },
				...(displaced
					? [{ type: 'featureMatchAssignment:deleted' as const, payload: { featureMatchAssignmentId: displaced.id } }]
					: []),
				...clearedSlots.map(featureMatch => ({ type: 'featureMatch:updated' as const, payload: { featureMatch } })),
				{ type: 'featureMatch:updated', payload: { featureMatch: promoted } },
			];

			return {
				outcome: promotedSlot.matchId === pre.matchId ? 'won' : 'won-then-moved',
				messages,
				// Answered as things are now, so this operator's client cannot overwrite
				// a move it has already applied with what this promotion committed.
				response: {
					promotedSlot: promoted,
					clearedSlots,
					assignment: current.assignment ? mapFeatureMatchAssignmentToResponse(current.assignment) : committedAssignment,
				},
			};
		},
	};
}
