import { mapFeatureMatchToResponse } from '~~/server/mappers/featureMatch';
import { featureMatchSlotParamsSchema } from '~~/server/schemas/api/featureMatch';
import { eventService } from '~~/server/services/event';
import { featureMatchService } from '~~/server/services/featureMatch';
import { matchService } from '~~/server/services/match';
import { phaseService } from '~~/server/services/phase';
import { roundService } from '~~/server/services/round';
import { featureMatchTokenValues } from '~~/shared/featureMatchOverlayValues';
import { toFeatureMatchDefaults } from '~~/shared/types/featureMatchDefaults';
import { formatClockDisplay } from '~~/shared/utils/clock';

/**
 * A Feature Match Slot as its Feature Match Overlay would show it, for outside
 * tools such as a vMix JSON Data Source (ADR-0056).
 *
 * One row of strings in a one-element array, because vMix reads an array as
 * rows and would show `null` as the text "null". The tokens and the clock follow
 * the Overlay's own rules, the clock read at request time; an output must not
 * change live state by reading it, so a Slot with no Session starts none.
 *
 * A stopgap for vMix alone: each Player's first and second game win as a colour,
 * white once won and transparent before, so a shape can bind to it. Eight hex
 * digits read the same as ARGB or RGBA.
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

	const featureMatch = mapFeatureMatchToResponse(slot);
	const state = featureMatch.activeSession?.currentState ?? null;
	const lifeOf = (lifeTotal: number | null | undefined) => lifeTotal == null
		? ''
		: String(lifeTotal);
	const winColour = (gameWins: number | undefined, game: number) => (gameWins ?? 0) >= game
		? '#FFFFFFFF'
		: '#00000000';

	setResponseHeader(event, 'access-control-allow-origin', '*');
	setResponseHeader(event, 'cache-control', 'no-store');

	return [
		{
			...featureMatchTokenValues({
				event: eventData,
				featureMatch,
				sourceMatch,
				round,
				phase,
			}),
			clock: formatClockDisplay(state?.clock ?? null, Date.now(), toFeatureMatchDefaults(eventData).untimedLabel),
			player1Life: lifeOf(state?.player1.lifeTotal),
			player1GameWins: String(state?.player1.gameWins ?? 0),
			player2Life: lifeOf(state?.player2.lifeTotal),
			player2GameWins: String(state?.player2.gameWins ?? 0),
			player1Game1Win: winColour(state?.player1.gameWins, 1),
			player1Game2Win: winColour(state?.player1.gameWins, 2),
			player2Game1Win: winColour(state?.player2.gameWins, 1),
			player2Game2Win: winColour(state?.player2.gameWins, 2),
		},
	];
});
