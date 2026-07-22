import { z } from 'zod';
import { eventParamsSchema } from '~~/server/schemas/api/event';
import { playerService } from '~~/server/services/player';
import { playerRoundStandingsService } from '~~/server/services/playerRoundStandings';
import { roundService } from '~~/server/services/round';

const querySchema = z.object({
	roundId: z.coerce.number().int().positive().optional(),
});

export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(event, eventParamsSchema.parse);
	const { roundId } = await getValidatedQuery(event, querySchema.parse);

	// If no roundId specified, return current player standings
	if (!roundId) {
		const players = await playerService().findAll({ eventId: id });
		return {
			standings: (players ?? [])
				.filter(p => p.wins !== null || p.losses !== null || p.position !== null)
				.sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity))
				.map(p => ({
					playerId: p.id,
					name: p.name,
					wins: p.wins,
					losses: p.losses,
					draws: p.draws,
					position: p.position,
					points: p.points,
				})),
			roundId: null,
		};
	}

	// Verify round exists
	const round = await roundService().findById(roundId, id);
	if (!round) {
		throw createError({ statusCode: 404, message: 'Round not found' });
	}

	// Get snapshot standings for the round
	const snapshots = await playerRoundStandingsService().findByRoundId(id, roundId);

	// Enrich with player names
	const players = await playerService().findAll({ eventId: id, includeInactive: true });
	const playerMap = new Map((players ?? []).map(p => [p.id, p]));

	return {
		standings: snapshots.map((s) => {
			const player = playerMap.get(s.playerId);
			return {
				playerId: s.playerId,
				name: player?.name ?? 'Unknown',
				wins: s.wins,
				losses: s.losses,
				draws: s.draws,
				position: s.position,
				points: s.points,
				createdAt: new Date(s.createdAt),
				updatedAt: new Date(s.updatedAt),
			};
		}),
		roundId,
	};
});
