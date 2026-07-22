import type { CreateRoundInput, RoundResponse, UpdateRoundInput } from '~~/shared/api';
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

	async function remove({ eventId, roundId, originConnectionId }: RemoveRoundParams): Promise<void> {
		const deleted = await rounds.remove(roundId, eventId);
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
		remove,
	};
}
