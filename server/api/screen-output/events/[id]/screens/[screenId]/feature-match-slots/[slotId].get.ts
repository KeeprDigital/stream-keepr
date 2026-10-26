import type { ScreenOutputFeatureMatchResponse } from '~~/shared/types/screenOutputReads';
import { z } from 'zod';
import { mapFeatureMatchToResponse } from '~~/server/mappers/featureMatch';
import { mapMatchToResponse } from '~~/server/mappers/match';
import { mapPhaseToResponse } from '~~/server/mappers/phase';
import { mapRoundToResponse } from '~~/server/mappers/round';
import { matchService } from '~~/server/services/match';
import { phaseService } from '~~/server/services/phase';
import { roundService } from '~~/server/services/round';
import { requireScreenOutputFeatureMatchSlot } from '~~/server/utils/screenOutputRead';

const paramsSchema = z.object({
	slotId: z.coerce.number().int().positive(),
});

/**
 * The Feature Match Slot this Screen shows, its Feature Match Session, and the
 * Match, Round and Phase it is following (#604).
 *
 * Read-only: a Slot with no Session answers `activeSession: null` rather than
 * starting one, because an output must not change live state by reading it.
 */
export default defineEventHandler(async (event): Promise<ScreenOutputFeatureMatchResponse> => {
	const { slotId } = await getValidatedRouterParams(event, paramsSchema.parse);
	const { eventId, slot } = await requireScreenOutputFeatureMatchSlot(event, slotId);

	const match = slot.matchId
		? await matchService().findById(slot.matchId, eventId)
		: undefined;
	const round = match
		? await roundService().findById(match.roundId, eventId)
		: undefined;
	const phase = round
		? await phaseService().findById(round.phaseId, eventId)
		: undefined;

	return {
		slot: mapFeatureMatchToResponse(slot),
		match: match
			? mapMatchToResponse(match)
			: null,
		round: round
			? mapRoundToResponse(round)
			: null,
		phase: phase
			? mapPhaseToResponse(phase)
			: null,
	};
});
