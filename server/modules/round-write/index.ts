import type { UpdateRoundInput } from '~~/server/schemas/api/round';
import type { CreateRoundInput, RoundResponse } from '~~/shared/api';
import { eventDataPublicationModule } from '~~/server/modules/event-data-publication';
import { roundService } from '~~/server/services/round';
import { requirePhaseInEvent } from '~~/server/utils/routeGuards';

interface CreateRoundParams {
	eventId: number;
	input: CreateRoundInput;
	originConnectionId?: string;
}

interface UpdateRoundParams {
	eventId: number;
	roundId: number;
	input: UpdateRoundInput;
	originConnectionId?: string;
}

interface StartRoundParams {
	eventId: number;
	roundId: number;
	originConnectionId?: string;
}

interface RemoveRoundParams {
	eventId: number;
	roundId: number;
	originConnectionId?: string;
}

export function roundWriteModule() {
	const publication = eventDataPublicationModule();
	const rounds = roundService();

	async function create({ eventId, input, originConnectionId }: CreateRoundParams): Promise<RoundResponse> {
		await requirePhaseInEvent(eventId, input.phaseId);

		const newRound = await rounds.create(eventId, input);

		return await publication.roundCreated({
			eventId,
			entity: newRound,
			originConnectionId,
		});
	}

	async function update({ eventId, roundId, input, originConnectionId }: UpdateRoundParams): Promise<RoundResponse> {
		await requirePhaseInEvent(eventId, input.phaseId);

		const updatedRound = await rounds.update(roundId, eventId, input);
		if (!updatedRound) {
			throw createError({ statusCode: 404, message: 'Round not found' });
		}

		return await publication.roundUpdated({
			eventId,
			entity: updatedRound,
			originConnectionId,
		});
	}

	/** "Start now": the Round starts at server time, so every Round Clock counts from one instant (ADR-0066). */
	async function start({ eventId, roundId, originConnectionId }: StartRoundParams): Promise<RoundResponse> {
		return await update({
			eventId,
			roundId,
			input: {
				startedAt: new Date(),
			},
			originConnectionId,
		});
	}

	async function remove({ eventId, roundId, originConnectionId }: RemoveRoundParams): Promise<void> {
		const { deleted, clearedScreens } = await rounds.remove(roundId, eventId);

		// Even for a Round already gone: the release committed either way (ADR-0060).
		// No origin, because the deleting client never received these Screens back.
		for (const screen of clearedScreens)
			await publication.screenUpdated({ eventId, entity: screen });

		if (!deleted) {
			throw createError({ statusCode: 404, message: 'Round not found' });
		}

		await publication.roundDeleted({
			eventId,
			id: roundId,
			originConnectionId,
		});
	}

	return {
		create,
		update,
		start,
		remove,
	};
}
