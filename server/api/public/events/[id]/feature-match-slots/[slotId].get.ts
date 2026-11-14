import { mapFeatureMatchToResponse } from '~~/server/mappers/featureMatch';
import { featureMatchSlotParamsSchema } from '~~/server/schemas/api/featureMatch';
import { eventService } from '~~/server/services/event';
import { featureMatchService } from '~~/server/services/featureMatch';
import { matchService } from '~~/server/services/match';
import { phaseService } from '~~/server/services/phase';
import { roundService } from '~~/server/services/round';
import { featureMatchPublicRow } from '~~/server/utils/featureMatchPublicRow';

/**
 * A Feature Match Slot as its Feature Match Overlay would show it, for outside
 * tools such as a vMix JSON Data Source (ADR-0056).
 *
 * One row of strings in a one-element array, because vMix reads an array as
 * rows and would show `null` as the text "null". The tokens and the clock follow
 * the Overlay's own rules, the clock read at request time; an output must not
 * change live state by reading it, so a Slot with no Session starts none.
 *
 * What the row holds is `featureMatchPublicRow`'s to say: a Commander Slot's
 * four Seats, or any other Slot's pair.
 */
export default defineEventHandler(async (event) => {
	const { id, slotId } = await getValidatedRouterParams(event, featureMatchSlotParamsSchema.parse);

	const eventData = await eventService().findById(id);
	const slot = eventData
		? await featureMatchService().findById(slotId, id)
		: undefined;
	if (!eventData || !slot) {
		throw createError({ statusCode: 404, statusMessage: 'Feature Match Slot not found' });
	}

	const sourceMatch = slot.matchId
		? await matchService().findById(slot.matchId, id)
		: undefined;
	const round = sourceMatch
		? await roundService().findById(sourceMatch.roundId, id)
		: undefined;
	const phase = round
		? await phaseService().findById(round.phaseId, id)
		: undefined;

	setResponseHeader(event, 'access-control-allow-origin', '*');
	setResponseHeader(event, 'cache-control', 'no-store');

	return [
		featureMatchPublicRow({
			event: eventData,
			featureMatch: mapFeatureMatchToResponse(slot),
			sourceMatch,
			round,
			phase,
		}, Date.now()),
	];
});
