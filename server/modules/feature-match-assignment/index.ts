import type { DbFeatureMatchAssignment } from '~~/server/db/schema';
import type { SaveFeatureMatchAssignmentInput, UpdateFeatureMatchAssignmentInput } from '~~/shared/api';
import { mapFeatureMatchAssignmentToResponse } from '~~/server/mappers/featureMatchAssignment';
import { eventDataPublicationModule } from '~~/server/modules/event-data-publication';
import { featureMatchAssignmentService, isAssignmentDisplacementGuardViolation } from '~~/server/services/featureMatchAssignment';
import { StateConflictError } from '~~/server/utils/errors';
import { hasExactNoteDiscardConfirmation, throwFeatureMatchNoteDiscardRequired } from '~~/server/utils/featureMatchNoteDiscard';
import {
	requireRoundInEvent,
	validateFeatureMatchAssignmentCreateReferences,
} from '~~/server/utils/routeGuards';

/**
 * Feature Match Assignment workflow seam.
 *
 * Owns the Round-scoped saved-selection workflow: reference validation,
 * upsert/update/remove, not-found modes, and response mapping.
 */
export function featureMatchAssignmentModule() {
	const assignments = featureMatchAssignmentService();
	const eventData = eventDataPublicationModule();

	async function listByRound(eventId: number, roundId: number) {
		await requireRoundInEvent(eventId, roundId);
		const rows = await assignments.findByRound(eventId, roundId);
		return {
			featureMatchAssignments: rows.map(mapFeatureMatchAssignmentToResponse),
			total: rows.length,
		};
	}

	async function save(eventId: number, input: SaveFeatureMatchAssignmentInput, originConnectionId?: string) {
		const { confirmedNoteDiscards = [], ...assignmentInput } = input;
		await validateFeatureMatchAssignmentCreateReferences(eventId, assignmentInput);
		const [existingAtSlot, existingForMatch] = await Promise.all([
			assignments.findByRoundAndSlot(eventId, assignmentInput.roundId, assignmentInput.slotId),
			assignments.findByRoundAndMatch(eventId, assignmentInput.roundId, assignmentInput.matchId),
		]);
		const displacedAssignment = existingAtSlot?.matchId !== assignmentInput.matchId ? existingAtSlot : undefined;
		const hasExactConfirmation = displacedAssignment
			? hasExactNoteDiscardConfirmation(displacedAssignment, confirmedNoteDiscards)
			: false;
		if (
			displacedAssignment?.note?.trim()
			&& !hasExactConfirmation
		) {
			await throwFeatureMatchNoteDiscardRequired(eventId, displacedAssignment);
		}
		if (confirmedNoteDiscards.length > 0 && !hasExactConfirmation) {
			throw new StateConflictError(
				'Feature match assignment',
				displacedAssignment?.id ?? confirmedNoteDiscards[0]!.assignmentId,
			);
		}

		let assignment: DbFeatureMatchAssignment;
		try {
			assignment = await assignments.upsert(eventId, assignmentInput, displacedAssignment);
		}
		catch (error) {
			if (!isAssignmentDisplacementGuardViolation(error))
				throw error;
			const current = await assignments.findByRoundAndSlot(
				eventId,
				assignmentInput.roundId,
				assignmentInput.slotId,
			);
			if (current?.matchId !== assignmentInput.matchId && current?.note?.trim())
				await throwFeatureMatchNoteDiscardRequired(eventId, current);
			throw new StateConflictError('Feature match assignment', displacedAssignment?.id ?? assignmentInput.slotId);
		}
		if (existingForMatch)
			await eventData.featureMatchAssignmentUpdated({ eventId, entity: assignment, originConnectionId });
		else
			await eventData.featureMatchAssignmentCreated({ eventId, entity: assignment, originConnectionId });
		if (existingAtSlot && existingAtSlot.id !== assignment.id)
			await eventData.featureMatchAssignmentDeleted({ eventId, id: existingAtSlot.id, originConnectionId });
		return mapFeatureMatchAssignmentToResponse(assignment);
	}

	async function requireExisting(eventId: number, assignmentId: number): Promise<DbFeatureMatchAssignment> {
		const existing = await assignments.findById(eventId, assignmentId);
		if (!existing)
			throw createError({ statusCode: 404, message: 'Feature match assignment not found' });
		return existing;
	}

	async function update(eventId: number, assignmentId: number, input: UpdateFeatureMatchAssignmentInput, originConnectionId?: string) {
		await requireExisting(eventId, assignmentId);
		const assignment = await assignments.update(eventId, assignmentId, input);
		if (!assignment)
			throw createError({ statusCode: 404, message: 'Feature match assignment not found' });
		await eventData.featureMatchAssignmentUpdated({ eventId, entity: assignment, originConnectionId });
		return mapFeatureMatchAssignmentToResponse(assignment);
	}

	async function remove(eventId: number, assignmentId: number, originConnectionId?: string) {
		const removed = await assignments.remove(eventId, assignmentId);
		if (!removed)
			throw createError({ statusCode: 404, message: 'Feature match assignment not found' });
		await eventData.featureMatchAssignmentDeleted({ eventId, id: assignmentId, originConnectionId });
		return { success: true };
	}

	return { listByRound, save, update, remove };
}
