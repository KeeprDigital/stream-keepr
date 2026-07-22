import type { DbFeatureMatchAssignment } from '~~/server/db/schema';
import type { CreateFeatureMatchAssignmentInput, UpdateFeatureMatchAssignmentInput } from '~~/shared/api';
import { mapFeatureMatchAssignmentToResponse } from '~~/server/mappers/featureMatchAssignment';
import { featureMatchAssignmentService } from '~~/server/services/featureMatchAssignment';
import {
	requireRoundInEvent,
	validateFeatureMatchAssignmentCreateReferences,
	validateFeatureMatchAssignmentUpdateReferences,
} from '~~/server/utils/routeGuards';

/**
 * Feature Match Assignment workflow seam.
 *
 * Owns the Round-scoped saved-selection workflow: reference validation,
 * upsert/update/remove, not-found modes, and response mapping.
 */
export function featureMatchAssignmentModule() {
	const assignments = featureMatchAssignmentService();

	async function listByRound(eventId: number, roundId: number) {
		await requireRoundInEvent(eventId, roundId);
		const rows = await assignments.findByRound(eventId, roundId);
		return {
			featureMatchAssignments: rows.map(mapFeatureMatchAssignmentToResponse),
			total: rows.length,
		};
	}

	async function save(eventId: number, input: CreateFeatureMatchAssignmentInput) {
		await validateFeatureMatchAssignmentCreateReferences(eventId, input);
		const assignment = await assignments.upsert(eventId, input);
		return mapFeatureMatchAssignmentToResponse(assignment);
	}

	async function requireExisting(eventId: number, assignmentId: number): Promise<DbFeatureMatchAssignment> {
		const existing = await assignments.findById(eventId, assignmentId);
		if (!existing)
			throw createError({ statusCode: 404, message: 'Feature match assignment not found' });
		return existing;
	}

	async function update(eventId: number, assignmentId: number, input: UpdateFeatureMatchAssignmentInput) {
		const existing = await requireExisting(eventId, assignmentId);
		await validateFeatureMatchAssignmentUpdateReferences(eventId, existing, input);
		const assignment = await assignments.update(eventId, assignmentId, input);
		if (!assignment)
			throw createError({ statusCode: 404, message: 'Feature match assignment not found' });
		return mapFeatureMatchAssignmentToResponse(assignment);
	}

	async function remove(eventId: number, assignmentId: number) {
		const removed = await assignments.remove(eventId, assignmentId);
		if (!removed)
			throw createError({ statusCode: 404, message: 'Feature match assignment not found' });
		return { success: true };
	}

	return { listByRound, save, update, remove };
}
