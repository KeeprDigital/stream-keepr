import type { DbPhase } from '~~/server/db/schema';
import type { PhaseResponse } from '~~/shared/api';
import { mapTimestamps } from '~~/server/utils/mapTimestamps';

export function mapPhaseToResponse(phase: DbPhase): PhaseResponse {
	return mapTimestamps(phase);
}
