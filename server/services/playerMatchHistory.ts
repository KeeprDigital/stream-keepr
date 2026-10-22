import { and, asc, eq, or } from 'drizzle-orm';
import { db } from '~~/server/db';
import { archetypes, matches, phases, players, rounds } from '~~/server/db/schema';
import { mapPlayerToResponse } from '~~/server/mappers/player';
import { readMatchFromPlayerSide, resolvePlayerArchetype } from '~~/shared/utils/matchFromPlayerSide';

/**
 * One Player's Matches across the Event, oldest phase first, with each outcome
 * read from that Player's side. `null` when the Event has no such Player.
 *
 * Shared by the operator's read and the Player History Screen Output's (#604).
 */
export async function findPlayerMatchHistory(eventId: number, playerId: number) {
	const player = await db.query.players.findFirst({
		where: and(eq(players.id, playerId), eq(players.eventId, eventId)),
	});

	if (!player)
		return null;

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
		const side = readMatchFromPlayerSide(match, playerId);
		const opponentArchetype = resolvePlayerArchetype(
			row.opponentArchetypeName == null ? null : { name: row.opponentArchetypeName, colors: row.opponentArchetypeColors },
			row.opponentGameData,
		);

		return {
			id: match.id,
			roundId: match.roundId,
			roundName: row.roundName,
			roundNumber: row.roundNumber,
			phaseName: row.phaseName,
			tableNumber: match.tableNumber,
			opponentId: match.isBye ? null : row.opponentId,
			opponentName: match.isBye ? 'BYE' : (row.opponentName ?? 'Unknown opponent'),
			opponentDeckName: match.isBye ? null : opponentArchetype.name,
			opponentDeckColors: match.isBye ? null : opponentArchetype.colors,
			...side,
			resultString: match.resultString,
		};
	});

	return { player: mapPlayerToResponse(player), history };
}
