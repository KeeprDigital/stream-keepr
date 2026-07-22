import type { DbPlayerRoundStandings } from '~~/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { db } from 'hub:db';
import { playerRoundStandings } from '~~/server/db/schema';

export interface RoundStandingInput {
	playerId: number;
	wins: number | null;
	losses: number | null;
	draws: number | null;
	position: number | null;
	points: number | null;
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

	return {
		findByRoundId,
	};
}
