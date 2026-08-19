import type { DbFeatureMatchAssignment } from '~~/server/db/schema';
import type { FeatureMatchNoteDiscardConfirmation } from '~~/shared/api';
import { mapFeatureMatchAssignmentToResponse } from '~~/server/mappers/featureMatchAssignment';
import { mapMatchToResponse } from '~~/server/mappers/match';
import { matchService } from '~~/server/services/match';

export function hasExactNoteDiscardConfirmation(
	assignment: DbFeatureMatchAssignment,
	confirmations: FeatureMatchNoteDiscardConfirmation[],
): boolean {
	return confirmations.some(confirmation =>
		confirmation.assignmentId === assignment.id
		&& confirmation.updatedAt.getTime() === assignment.updatedAt.getTime(),
	);
}

export async function throwFeatureMatchNoteDiscardRequired(
	eventId: number,
	assignment: DbFeatureMatchAssignment,
): Promise<never> {
	const match = await matchService().findById(assignment.matchId, eventId);
	if (!match)
		throw createError({ statusCode: 500, message: 'Failed to retrieve displaced Match' });

	throw createError({
		statusCode: 409,
		statusMessage: 'Feature Match Note discard requires confirmation',
		data: {
			code: 'feature-match-note-discard-required',
			assignments: [{
				assignment: mapFeatureMatchAssignmentToResponse(assignment),
				match: mapMatchToResponse(match),
			}],
		},
	});
}
