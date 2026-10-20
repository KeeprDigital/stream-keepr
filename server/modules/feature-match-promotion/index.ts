import type { BatchItem } from 'drizzle-orm/batch';
import type { FeatureMatchNoteDiscardConfirmation, FeatureMatchPromotionResponse } from '~~/shared/api';
import { db } from '~~/server/db';
import { eventDataPublicationModule } from '~~/server/modules/event-data-publication';
import { featureMatchService } from '~~/server/services/featureMatch';
import { buildAssignmentDisplacementGuardQuery, buildUpsertAssignmentQueries, featureMatchAssignmentService, isAssignmentDisplacementGuardViolation } from '~~/server/services/featureMatchAssignment';
import { featureMatchStateService } from '~~/server/services/featureMatchState';
import { buildMatchPromotionPlan, isMatchPromotionPlanStaleViolation, matchService } from '~~/server/services/match';
import { playerFeatureMatchSyncService } from '~~/server/services/playerFeatureMatchSync';
import { StateConflictError } from '~~/server/utils/errors';
import { hasExactNoteDiscardConfirmation, throwFeatureMatchNoteDiscardRequired } from '~~/server/utils/featureMatchNoteDiscard';
import { decidePromotion } from './decision';

/**
 * Whether a write failed because two Feature Match Slots would have held one
 * Match.
 *
 * SQLite names the columns of the index it rejected, not the index, so the
 * match column is what identifies this violation among the several unique
 * indexes a promotion batch writes through.
 */
function isDuplicateSlotMatchViolation(error: unknown): boolean {
	const message = error instanceof Error ? error.message : '';
	return message.includes('UNIQUE constraint failed')
		&& message.includes('feature_match_slots.match_id');
}

interface PromoteMatchToSlotInput {
	eventId: number;
	slotId: number;
	matchId: number;
	confirmedNoteDiscards?: FeatureMatchNoteDiscardConfirmation[];
	originConnectionId?: string;
}

/**
 * Feature Match Slot Promotion workflow seam.
 *
 * Owns the operator workflow for promoting a Match into a Feature Match Slot:
 * Slot/Match validation, duplicate Slot clearing, Feature Match Assignment
 * persistence, Feature Match Session resets, and running its outcome's
 * publication. What that outcome is, and what it publishes and answers, is
 * decided purely in `./decision`.
 */
export function featureMatchPromotionModule() {
	const matches = matchService();
	const slots = featureMatchService();
	const assignments = featureMatchAssignmentService();
	const state = featureMatchStateService();
	const eventData = eventDataPublicationModule();

	async function promoteMatchToSlot({
		eventId,
		slotId,
		matchId,
		confirmedNoteDiscards = [],
		originConnectionId,
	}: PromoteMatchToSlotInput): Promise<FeatureMatchPromotionResponse> {
		const match = await matches.findById(matchId, eventId);
		if (!match) {
			throw createError({ statusCode: 404, message: 'Match not found' });
		}

		const slot = await slots.findById(slotId, eventId);
		if (!slot) {
			throw createError({ statusCode: 404, message: 'Feature match slot not found' });
		}

		const [displacedAssignment, incomingAssignment] = await Promise.all([
			assignments.findByRoundAndSlot(eventId, match.roundId, slotId),
			assignments.findByRoundAndMatch(eventId, match.roundId, matchId),
		]);
		const assignmentToDisplace = displacedAssignment?.matchId !== matchId ? displacedAssignment : undefined;
		const hasExactConfirmation = assignmentToDisplace
			? hasExactNoteDiscardConfirmation(assignmentToDisplace, confirmedNoteDiscards)
			: false;
		if (
			assignmentToDisplace?.note?.trim()
			&& !hasExactConfirmation
		) {
			await throwFeatureMatchNoteDiscardRequired(eventId, assignmentToDisplace);
		}
		if (confirmedNoteDiscards.length > 0 && !hasExactConfirmation) {
			throw new StateConflictError(
				'Feature match assignment',
				assignmentToDisplace?.id ?? confirmedNoteDiscards[0]!.assignmentId,
			);
		}

		// Promote the Slot, refresh every displaced Slot's Session, upsert the
		// Assignment and open the promoted Slot's Session in ONE atomic D1 batch.
		// A partial failure can no longer leave a promoted Slot without an
		// Assignment, or a cleared Slot showing a stale Session, on the overlay.
		const defaults = await state.loadEventDefaults(eventId);
		const plan = await buildMatchPromotionPlan(eventId, slotId, match, slot);

		// Every Slot this promotion moves gets a new Session in the same commit as the
		// plan's fence, so a plan gone stale resets none of them (#605).
		const sessionReplacement = await state.buildSessionReplacement(
			eventId,
			[...plan.clearedSlots, plan.promotedSlot],
			{ defaults },
		);

		const assignmentQueries = buildUpsertAssignmentQueries(eventId, {
			roundId: match.roundId,
			slotId,
			matchId,
		});

		const batchQueries: BatchItem<'sqlite'>[] = [
			buildAssignmentDisplacementGuardQuery(eventId, {
				roundId: match.roundId,
				slotId,
				incomingMatchId: matchId,
				expectedAssignment: assignmentToDisplace,
			}),
			...plan.queries,
			...sessionReplacement.statements,
			...assignmentQueries,
		];
		try {
			await db.batch(batchQueries as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
		}
		catch (error) {
			// The plan is computed from reads, so a promotion that lost to a
			// concurrent one arrives here as its plan fence, or the one-Slot-per-Match
			// index behind it, aborting the batch — and, because the batch is one
			// transaction, with none of its own writes committed. Naming it a
			// conflict is what turns an operator's simultaneous promotion into a
			// `409` they can act on instead of a `500`.
			if (isDuplicateSlotMatchViolation(error) || isMatchPromotionPlanStaleViolation(error))
				throw new StateConflictError('Feature match slot', slotId);
			if (!isAssignmentDisplacementGuardViolation(error))
				throw error;

			const current = await assignments.findByRoundAndSlot(eventId, match.roundId, slotId);
			if (current?.matchId !== matchId && current?.note?.trim())
				await throwFeatureMatchNoteDiscardRequired(eventId, current);
			throw new StateConflictError('Feature match assignment', assignmentToDisplace?.id ?? slotId);
		}

		// Decide this promotion's outcome from what its commit left, before
		// anything is published (#576, #577). The Assignment is read before the
		// Slot, so a move that carried the Assignment off shows as a lost promotion.
		const committedAssignment = await assignments.findByRoundAndSlot(eventId, match.roundId, slotId);
		const committedSlot = await slots.findById(slotId, eventId);
		const decision = decidePromotion({
			slotId,
			matchId,
			continuedAssignment: incomingAssignment,
			displacedAssignment: assignmentToDisplace,
			clearedSlotIds: plan.clearedSlots.map(cleared => cleared.id),
		}, { slot: committedSlot, assignment: committedAssignment });
		if (decision.outcome === 'lost')
			throw new StateConflictError('Feature match slot', slotId);
		if (decision.outcome === 'failed')
			throw createError({ statusCode: 500, message: decision.message });

		// Reverse-sync the promoted players' latest data into the fresh Sessions
		// before reading what to publish, so the publication carries it. It runs
		// after the atomic promotion: it is a read-compute-write cycle with
		// intermediate session CAS that cannot compose into the batch. It
		// announces nothing itself, and a fault is answered only once the
		// committed promotion has been published, so peers still learn of it.
		const reverseSync = await playerFeatureMatchSyncService().syncMatchesFromPlayersAfterCommit(
			eventId,
			[match.player1Id, match.player2Id].filter((playerId): playerId is number => playerId != null),
		).then(() => ({ faulted: false as const }), (error: unknown) => ({ faulted: true as const, error }));

		// The Sessions are announced among the promotion's own messages, so the
		// whole promotion re-resolves Graphic Input Bindings once.
		const { opened } = await sessionReplacement.settle({ announce: false });
		const [currentSlots, currentAssignment] = await Promise.all([
			slots.findByEventId(eventId),
			assignments.findById(eventId, decision.assignment.id),
		]);
		const publication = decision.describe({ slots: currentSlots, assignment: currentAssignment, openedSessions: opened });
		if (publication.outcome === 'failed')
			throw createError({ statusCode: 500, message: publication.message });

		await eventData.eventDataChanged({ eventId, messages: publication.messages, originConnectionId });
		if (reverseSync.faulted)
			throw reverseSync.error;
		return publication.response;
	}

	return {
		promoteMatchToSlot,
	};
}
