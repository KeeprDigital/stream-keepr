import type { ScreenOutputStandingsResponse } from '~~/shared/types/screenOutputReads';
import { mapPlayerToResponse } from '~~/server/mappers/player';
import { mapRoundToResponse } from '~~/server/mappers/round';
import { playerService } from '~~/server/services/player';
import { playerListService } from '~~/server/services/playerList';
import { playerRoundStandingsService } from '~~/server/services/playerRoundStandings';
import { roundService } from '~~/server/services/round';
import { requireScreenOutputModeRead } from '~~/server/utils/screenOutputRead';

/**
 * Everything this Screen's Standings mode renders from, derived from its saved
 * configuration (#604): the roster, the Round it is fixed at, and the
 * watchlist it filters to. One read, so an output never assembles standings
 * from reads its capability does not reach.
 */
export default defineEventHandler(async (event): Promise<ScreenOutputStandingsResponse> => {
	const { eventId, config } = await requireScreenOutputModeRead(event, 'standings');

	const listId = config.viewMode === 'watchlist' ? config.playerListId : null;
	const [players, round, roundStandings, list] = await Promise.all([
		playerService().findAll({ eventId }),
		config.roundId ? roundService().findById(config.roundId, eventId) : null,
		config.roundId ? playerRoundStandingsService().findByRoundId(eventId, config.roundId) : null,
		listId ? playerListService().findById(listId, eventId) : null,
	]);
	// A watchlist whose list has since been deleted renders as no watchlist
	// rather than refusing the whole Standings read.
	const watchlistPlayerIds = list ? await playerListService().getMemberPlayerIds(list.id, eventId) : [];

	return {
		players: players.map(mapPlayerToResponse),
		round: round ? mapRoundToResponse(round) : null,
		roundStandings: roundStandings?.map(standing => ({
			playerId: standing.playerId,
			wins: standing.wins,
			losses: standing.losses,
			draws: standing.draws,
			position: standing.position,
			points: standing.points,
		})) ?? null,
		watchlist: list ? { name: list.name, playerIds: watchlistPlayerIds } : null,
	};
});
