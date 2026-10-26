import type { HeadToHeadModeConfig } from '~~/shared/types/screenConfig';
import type { ScreenOutputHeadToHeadResponse } from '~~/shared/types/screenOutputReads';
import type { HeadToHeadPlayerFacts } from '~~/shared/utils/headToHead';
import { and, desc, eq, or } from 'drizzle-orm';
import { db } from '~~/server/db';
import { archetypes, matches, phases, playerRoundStandings, players, rounds } from '~~/server/db/schema';
import { featureMatchService } from '~~/server/services/featureMatch';
import { projectHeadToHead } from '~~/shared/utils/headToHead';

/** The two Players a Head-to-Head names, and the Match they are about to play if a Slot says so. */
interface HeadToHeadSides {
	player1Id: number | null;
	player2Id: number | null;
	currentMatchId: number | null;
}

/**
 * Which Players the configuration shows: those its Feature Match Slot seats
 * now, following the Slot's current Feature Match Assignment, or those picked
 * directly. A Slot the Event no longer has seats no one.
 */
async function resolveSides(eventId: number, config: HeadToHeadModeConfig): Promise<HeadToHeadSides> {
	if (config.playerSource === 'players')
		return { player1Id: config.player1Id ?? null, player2Id: config.player2Id ?? null, currentMatchId: null };

	if (!config.featureMatchId)
		return { player1Id: null, player2Id: null, currentMatchId: null };

	const slot = await featureMatchService().findById(config.featureMatchId, eventId);
	return { player1Id: slot?.player1Id ?? null, player2Id: slot?.player2Id ?? null, currentMatchId: slot?.matchId ?? null };
}

/** One Player of the Event with their Archetype and latest Round Standings; `null` when the Event has no such Player. */
async function readPlayerFacts(eventId: number, playerId: number | null): Promise<HeadToHeadPlayerFacts | null> {
	if (playerId == null)
		return null;

	const [row] = await db
		.select({ player: players, archetypeName: archetypes.name, archetypeColors: archetypes.colors })
		.from(players)
		.leftJoin(archetypes, eq(archetypes.id, players.archetypeId))
		.where(and(eq(players.id, playerId), eq(players.eventId, eventId)));
	if (!row)
		return null;

	const [latestStanding] = await db
		.select({
			wins: playerRoundStandings.wins,
			losses: playerRoundStandings.losses,
			draws: playerRoundStandings.draws,
			points: playerRoundStandings.points,
		})
		.from(playerRoundStandings)
		.innerJoin(rounds, eq(rounds.id, playerRoundStandings.roundId))
		.innerJoin(phases, eq(phases.id, rounds.phaseId))
		.where(and(eq(playerRoundStandings.eventId, eventId), eq(playerRoundStandings.playerId, playerId)))
		.orderBy(desc(phases.sortOrder), desc(rounds.roundNumber), desc(rounds.id))
		.limit(1);

	return {
		player: row.player,
		archetype: row.archetypeName == null
			? null
			: { name: row.archetypeName, colors: row.archetypeColors },
		latestStanding: latestStanding ?? null,
	};
}

/** The Event's Matches seating both Players, with where each was played. */
async function readMatchesBetween(eventId: number, player1Id: number, player2Id: number) {
	const rows = await db
		.select({
			match: matches,
			roundName: rounds.name,
			roundNumber: rounds.roundNumber,
			phaseName: phases.name,
			phaseSortOrder: phases.sortOrder,
		})
		.from(matches)
		.innerJoin(rounds, eq(rounds.id, matches.roundId))
		.innerJoin(phases, eq(phases.id, rounds.phaseId))
		.where(and(
			eq(matches.eventId, eventId),
			or(
				and(eq(matches.player1Id, player1Id), eq(matches.player2Id, player2Id)),
				and(eq(matches.player1Id, player2Id), eq(matches.player2Id, player1Id)),
			),
		));

	return rows.map(({ match, ...playedIn }) => ({
		...match,
		...playedIn,
	}));
}

/**
 * Two Players of an Event side by side (#760): each one's record, points and
 * deck, and their earlier Matches at the Event. A side no Player of the Event
 * fills is `null`.
 *
 * The Head-to-Head Screen Output's read.
 */
export async function findHeadToHead(eventId: number, config: HeadToHeadModeConfig): Promise<ScreenOutputHeadToHeadResponse> {
	const sides = await resolveSides(eventId, config);
	const [player1, player2] = await Promise.all([
		readPlayerFacts(eventId, sides.player1Id),
		readPlayerFacts(eventId, sides.player2Id),
	]);
	const matchesBetween = player1 && player2
		? await readMatchesBetween(eventId, player1.player.id, player2.player.id)
		: [];

	return projectHeadToHead({
		player1,
		player2,
		matches: matchesBetween,
		currentMatchId: sides.currentMatchId,
	});
}
