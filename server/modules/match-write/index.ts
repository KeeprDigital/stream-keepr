import type { CreateMatchInput, MatchResponse, UpdateMatchInput } from '~~/shared/api';
import { eventDataPublicationModule } from '~~/server/modules/event-data-publication';
import { matchService } from '~~/server/services/match';
import { requirePlayersInEvent, requireRoundInEvent } from '~~/server/utils/routeGuards';

interface CreateMatchParams {
	eventId: number;
	input: CreateMatchInput;
	originConnectionId?: string;
}

interface UpdateMatchParams {
	eventId: number;
	matchId: number;
	input: UpdateMatchInput;
	originConnectionId?: string;
}

interface RemoveMatchParams {
	eventId: number;
	matchId: number;
	originConnectionId?: string;
}

export function matchWriteModule() {
	const publication = eventDataPublicationModule();
	const matches = matchService();

	async function create({ eventId, input, originConnectionId }: CreateMatchParams): Promise<MatchResponse> {
		await requireRoundInEvent(eventId, input.roundId);
		await requirePlayersInEvent(eventId, [input.player1Id, input.player2Id]);

		const newMatch = await matches.create(eventId, input);

		return await publication.matchCreated({
			eventId,
			entity: newMatch,
			originConnectionId,
		});
	}

	async function update({ eventId, matchId, input, originConnectionId }: UpdateMatchParams): Promise<MatchResponse> {
		await requireRoundInEvent(eventId, input.roundId);
		await requirePlayersInEvent(eventId, [input.player1Id, input.player2Id]);

		const updatedMatch = await matches.update(matchId, eventId, input);
		if (!updatedMatch) {
			throw createError({ statusCode: 404, message: 'Match not found' });
		}

		return await publication.matchUpdated({
			eventId,
			entity: updatedMatch,
			originConnectionId,
		});
	}

	async function remove({ eventId, matchId, originConnectionId }: RemoveMatchParams): Promise<void> {
		const deleted = await matches.remove(matchId, eventId);
		if (!deleted) {
			throw createError({ statusCode: 404, message: 'Match not found' });
		}

		await publication.matchDeleted({
			eventId,
			id: matchId,
			originConnectionId,
		});
	}

	return {
		create,
		update,
		remove,
	};
}
