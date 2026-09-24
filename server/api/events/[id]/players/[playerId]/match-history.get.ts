import { and, asc, eq, or } from 'drizzle-orm';
import { db } from '~~/server/db';
import { archetypes, matches, phases, players, rounds } from '~~/server/db/schema';
import { mapPlayerToResponse } from '~~/server/mappers/player';
import { playerParamsSchema } from '~~/server/schemas/api/player';
import { getMtgGameData } from '~~/shared/utils/gameData';

export default defineEventHandler(async (event) => {
	const { id: eventId, playerId } = await getValidatedRouterParams(event, playerParamsSchema.parse);

	const player = await db.query.players.findFirst({
		where: and(eq(players.id, playerId), eq(players.eventId, eventId)),
	});

	if (!player) {
		throw createError({ statusCode: 404, message: 'Player not found' });
	}

	const rows = await db
		.select({
			match: matches,
			roundName: rounds.name,
			roundNumber: rounds.roundNumber,
			phaseName: phases.name,
			phaseSortOrder: phases.sortOrder,
			opponentId: players.id,
			opponentName: players.name,
			opponentGameData: players.gameData,
			opponentArchetypeName: archetypes.name,
			opponentArchetypeColors: archetypes.colors,
		})
		.from(matches)
		.innerJoin(rounds, eq(matches.roundId, rounds.id))
		.innerJoin(phases, eq(rounds.phaseId, phases.id))
		.leftJoin(players, or(
			and(eq(matches.player1Id, playerId), eq(players.id, matches.player2Id)),
			and(eq(matches.player2Id, playerId), eq(players.id, matches.player1Id)),
		))
		.leftJoin(archetypes, eq(players.archetypeId, archetypes.id))
		.where(and(
			eq(matches.eventId, eventId),
			or(eq(matches.player1Id, playerId), eq(matches.player2Id, playerId)),
		))
		.orderBy(asc(phases.sortOrder), asc(rounds.roundNumber), asc(matches.sortOrder), asc(matches.id));

	const history = rows.map((row) => {
		const match = row.match;
		const isPlayer1 = match.player1Id === playerId;
		const playerGameWins = isPlayer1 ? match.player1GameWins : match.player2GameWins;
		const opponentGameWins = isPlayer1 ? match.player2GameWins : match.player1GameWins;
		let outcome: 'win' | 'loss' | 'draw' | 'bye' | 'pending' = 'pending';

		if (match.isBye) {
			outcome = 'bye';
		}
		else if (match.hasResult && playerGameWins != null && opponentGameWins != null) {
			if (playerGameWins > opponentGameWins)
				outcome = 'win';
			else if (playerGameWins < opponentGameWins)
				outcome = 'loss';
			else
				outcome = 'draw';
		}

		const opponentMtgData = getMtgGameData(row.opponentGameData);
		const opponentDeckName = row.opponentArchetypeName ?? opponentMtgData.deckName ?? null;
		const opponentDeckColors = row.opponentArchetypeColors ?? opponentMtgData.deckColors ?? null;

		return {
			id: match.id,
			roundId: match.roundId,
			roundName: row.roundName,
			roundNumber: row.roundNumber,
			phaseName: row.phaseName,
			tableNumber: match.tableNumber,
			opponentId: match.isBye ? null : row.opponentId,
			opponentName: match.isBye ? 'BYE' : (row.opponentName ?? 'Unknown opponent'),
			opponentDeckName: match.isBye ? null : opponentDeckName,
			opponentDeckColors: match.isBye ? null : opponentDeckColors,
			outcome,
			playerGameWins,
			opponentGameWins,
			gameDraws: match.gameDraws,
			hasResult: match.hasResult,
			resultString: match.resultString,
		};
	});

	return { player: mapPlayerToResponse(player), history };
});
