import type { BatchItem } from 'drizzle-orm/batch';
import type { FeatureMatchNoteDiscardConfirmation, FeatureMatchPromotionResponse } from '~~/shared/api';
import { db } from '~~/server/db';
import { mapFeatureMatchAssignmentToResponse } from '~~/server/mappers/featureMatchAssignment';
import { eventDataPublicationModule } from '~~/server/modules/event-data-publication';
import { featureMatchService } from '~~/server/services/featureMatch';
import { buildAssignmentDisplacementGuardQuery, buildUpsertAssignmentQueries, featureMatchAssignmentService, isAssignmentDisplacementGuardViolation } from '~~/server/services/featureMatchAssignment';
import { featureMatchStateService } from '~~/server/services/featureMatchState';
import { buildMatchPromotionPlan, matchService } from '~~/server/services/match';
import { playerFeatureMatchSyncService } from '~~/server/services/playerFeatureMatchSync';
import { StateConflictError } from '~~/server/utils/errors';
import { hasExactNoteDiscardConfirmation, throwFeatureMatchNoteDiscardRequired } from '~~/server/utils/featureMatchNoteDiscard';

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
 * persistence, Feature Match Session resets, response mapping, and realtime
 * Event Data publication.
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

		const clearedSessionQueries: BatchItem<'sqlite'>[] = [];
		for (const clearedSlot of plan.clearedSlots) {
			const { queries } = await state.buildCreateSessionForSlotQueries(clearedSlot, eventId, defaults);
			clearedSessionQueries.push(...queries);
		}

		const assignmentQueries = buildUpsertAssignmentQueries(eventId, {
			roundId: match.roundId,
			slotId,
			matchId,
		});

		const { queries: promotedSessionQueries } = await state.buildCreateSessionForSlotQueries(plan.promotedSlot, eventId, defaults);

		const batchQueries: BatchItem<'sqlite'>[] = [
			buildAssignmentDisplacementGuardQuery(eventId, {
				roundId: match.roundId,
				slotId,
				incomingMatchId: matchId,
				expectedAssignment: assignmentToDisplace,
			}),
			...plan.queries,
			...clearedSessionQueries,
			...assignmentQueries,
			...promotedSessionQueries,
		];
		try {
			await db.batch(batchQueries as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
		}
		catch (error) {
			// The single-Slot invariant is enforced by a unique index rather than by
			// the plan alone, so a promotion that lost to a concurrent one arrives
			// here as a constraint violation — and, because the batch is one
			// transaction, with none of its own writes committed. Naming it a
			// conflict is what turns an operator's simultaneous promotion into a
			// `409` they can act on instead of a `500`.
			if (isDuplicateSlotMatchViolation(error))
				throw new StateConflictError('Feature match slot', slotId);
			if (!isAssignmentDisplacementGuardViolation(error))
				throw error;

			const current = await assignments.findByRoundAndSlot(eventId, match.roundId, slotId);
			if (current?.matchId !== matchId && current?.note?.trim())
				await throwFeatureMatchNoteDiscardRequired(eventId, current);
			throw new StateConflictError('Feature match assignment', assignmentToDisplace?.id ?? slotId);
		}

		const assignment = await assignments.findByRoundAndSlot(eventId, match.roundId, slotId);
		if (!assignment) {
			throw createError({ statusCode: 500, message: 'Failed to save feature match assignment' });
		}

		// Assignment notifications describe the authoritative batch write and must
		// not wait behind the optional reverse-sync follow-on. If that later work
		// faults, peers still learn about the committed Assignment lifecycle.
		if (incomingAssignment)
			await eventData.featureMatchAssignmentUpdated({ eventId, entity: assignment, originConnectionId });
		else
			await eventData.featureMatchAssignmentCreated({ eventId, entity: assignment, originConnectionId });
		if (assignmentToDisplace && assignmentToDisplace.id !== assignment.id)
			await eventData.featureMatchAssignmentDeleted({ eventId, id: assignmentToDisplace.id, originConnectionId });

		// Reverse-sync the promoted players' latest data into the fresh Sessions.
		// This runs after the atomic promotion: it is a read-compute-write cycle
		// with intermediate session CAS that cannot compose into the batch, and a
		// failure here leaves a consistent promotion (the Session simply keeps the
		// Match's embedded snapshot until the next player update).
		await playerFeatureMatchSyncService().syncMatchesFromPlayersAfterCommit(
			eventId,
			[match.player1Id, match.player2Id].filter((playerId): playerId is number => playerId != null),
		);

		const clearedSlots = [];
		for (const clearedSlot of plan.clearedSlots) {
			const refreshedClearedSlot = await slots.findById(clearedSlot.id, eventId);
			if (refreshedClearedSlot) {
				const clearedResponse = await eventData.featureMatchSlotUpdated({
					eventId,
					entity: refreshedClearedSlot,
					originConnectionId,
				});
				clearedSlots.push(clearedResponse);
			}
		}

		const promotedSlot = await slots.findById(slotId, eventId);
		if (!promotedSlot) {
			throw createError({ statusCode: 500, message: 'Failed to retrieve updated feature match slot' });
		}
		if (promotedSlot.matchId !== matchId) {
			// The batch committed, so this Slot did hold the Match; another promotion
			// has taken it since. Answering with the Slot as it is now would report
			// somebody else's promotion as this one's result.
			throw new StateConflictError('Feature match slot', slotId);
		}

		const response = await eventData.featureMatchSlotUpdated({
			eventId,
			entity: promotedSlot,
			originConnectionId,
		});

		return {
			promotedSlot: response,
			clearedSlots,
			assignment: mapFeatureMatchAssignmentToResponse(assignment),
		};
	}

	return {
		promoteMatchToSlot,
	};
}
