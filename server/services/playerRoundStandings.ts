import type { DbPlayerRoundStandings } from '~~/server/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '~~/server/db';
import { phases, playerRoundStandings, rounds } from '~~/server/db/schema';

export interface RoundStandingInput {
	playerId: number;
	wins: number | null;
	losses: number | null;
	draws: number | null;
	position: number | null;
	points: number | null;
}

/** Each Player's position in one Round's Round Standings. */
export interface RoundStandingPositions {
	roundId: number;
	positions: Array<{ playerId: number; position: number | null }>;
}

export function playerRoundStandingsService() {
	/**
	 * Get standings snapshot for a specific round.
	 */
	const findByRoundId = async (
		eventId: number,
		roundId: number,
	): Promise<DbPlayerRoundStandings[]> => {
		return await db
			.select()
			.from(playerRoundStandings)
			.where(
				and(
					eq(playerRoundStandings.eventId, eventId),
					eq(playerRoundStandings.roundId, roundId),
				),
			)
			.orderBy(playerRoundStandings.position);
	};

	/**
	 * The Round Standings a Standings Screen's Position Change is measured
	 * against (#755): the nearest Round before `roundId`, in the Event's Round
	 * order (Phase sort order, then round number), that holds Round Standings.
	 * A Round without them, such as a manual one, is passed over.
	 *
	 * Current standings (`roundId` null) stand as the latest Round holding Round
	 * Standings, so they are measured against the one before it.
	 *
	 * `null` when there is no such Round: the first Round, or a Round outside
	 * the Event.
	 */
	const findPreviousRoundPositions = async (
		eventId: number,
		roundId: number | null,
	): Promise<RoundStandingPositions | null> => {
		const ordered = await db
			.select({
				id: rounds.id,
				hasStandings: sql<number>`exists (select 1 from ${playerRoundStandings} where ${playerRoundStandings.roundId} = ${rounds.id} and ${playerRoundStandings.eventId} = ${eventId})`,
			})
			.from(rounds)
			.innerJoin(phases, eq(phases.id, rounds.phaseId))
			.where(eq(rounds.eventId, eventId))
			.orderBy(phases.sortOrder, rounds.roundNumber, rounds.id);

		const withStandings = (upTo: number) => ordered.slice(0, upTo).filter(round => round.hasStandings);
		let previousRoundId: number | undefined;
		if (roundId == null) {
			previousRoundId = withStandings(ordered.length).at(-2)?.id;
		}
		else {
			const index = ordered.findIndex(round => round.id === roundId);
			previousRoundId = index > 0 ? withStandings(index).at(-1)?.id : undefined;
		}
		if (previousRoundId == null)
			return null;

		const positions = await db
			.select({ playerId: playerRoundStandings.playerId, position: playerRoundStandings.position })
			.from(playerRoundStandings)
			.where(and(
				eq(playerRoundStandings.eventId, eventId),
				eq(playerRoundStandings.roundId, previousRoundId),
			));

		return { roundId: previousRoundId, positions };
	};

	return {
		findByRoundId,
		findPreviousRoundPositions,
	};
}
