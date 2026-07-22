import type { BatchItem } from 'drizzle-orm/batch';
import type { FeatureMatchPromotionResponse } from '~~/shared/api';
import { db } from 'hub:db';
import { mapFeatureMatchAssignmentToResponse } from '~~/server/mappers/featureMatchAssignment';
import { eventDataPublicationModule } from '~~/server/modules/event-data-publication';
import { featureMatchService } from '~~/server/services/featureMatch';
import { buildUpsertAssignmentQueries, featureMatchAssignmentService } from '~~/server/services/featureMatchAssignment';
import { featureMatchStateService } from '~~/server/services/featureMatchState';
import { buildMatchPromotionPlan, matchService } from '~~/server/services/match';
import { playerFeatureMatchSyncService } from '~~/server/services/playerFeatureMatchSync';

interface PromoteMatchToSlotInput {
	eventId: number;
	slotId: number;
	matchId: number;
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
			...plan.queries,
			...clearedSessionQueries,
			...assignmentQueries,
			...promotedSessionQueries,
		];
		await db.batch(batchQueries as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);

		// Reverse-sync the promoted players' latest data into the fresh Sessions.
		// This runs after the atomic promotion: it is a read-compute-write cycle
		// with intermediate session CAS that cannot compose into the batch, and a
		// failure here leaves a consistent promotion (the Session simply keeps the
		// Match's embedded snapshot until the next player update).
		await playerFeatureMatchSyncService().syncMatchesFromPlayers(
			eventId,
			[match.player1Id, match.player2Id].filter((playerId): playerId is number => playerId != null),
		);

		const assignment = await assignments.findByRoundAndSlot(eventId, match.roundId, slotId);
		if (!assignment) {
			throw createError({ statusCode: 500, message: 'Failed to save feature match assignment' });
		}

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
