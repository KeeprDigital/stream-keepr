import type { DbFeatureMatchAssignment } from '~~/server/db/schema';
import type { FeatureMatchAssignmentResponse } from '~~/shared/api';
import { mapTimestamps } from '~~/server/utils/mapTimestamps';

export function mapFeatureMatchAssignmentToResponse(assignment: DbFeatureMatchAssignment): FeatureMatchAssignmentResponse {
	return mapTimestamps(assignment);
}
