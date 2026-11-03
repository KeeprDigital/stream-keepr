import type { DbPlayerRoundStandings } from '~~/server/db/schema';
import type { EventRound } from '~~/shared/utils/eventRoundOrder';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '~~/server/db';
import { phases, playerRoundStandings, players, rounds } from '~~/server/db/schema';
import { previousStandingsRoundId, seedingRoundId } from '~~/shared/utils/eventRoundOrder';

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

/** A Player a Phase seeds, by their current name, and their Seed. */
export interface SeededPlayerRow {
	playerId: number;
	name: string;
	seed: number;
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

	/** The Event's Rounds in Round order (Phase sort order, then round number), each marked by whether it holds Round Standings. */
	const listEventRounds = async (eventId: number): Promise<EventRound[]> => {
		const ordered = await db
			.select({
				id: rounds.id,
				phaseId: rounds.phaseId,
				hasStandings: sql<number>`exists (select 1 from ${playerRoundStandings} where ${playerRoundStandings.roundId} = ${rounds.id} and ${playerRoundStandings.eventId} = ${eventId})`,
			})
			.from(rounds)
			.innerJoin(phases, eq(phases.id, rounds.phaseId))
			.where(eq(rounds.eventId, eventId))
			.orderBy(phases.sortOrder, rounds.roundNumber, rounds.id);
		return ordered.map(round => ({
			...round,
			hasStandings: Boolean(round.hasStandings),
		}));
	};

	const findRoundPositions = async (eventId: number, roundId: number | null): Promise<RoundStandingPositions | null> => {
		if (roundId == null)
			return null;
		const positions = await db
			.select({ playerId: playerRoundStandings.playerId, position: playerRoundStandings.position })
			.from(playerRoundStandings)
			.where(and(
				eq(playerRoundStandings.eventId, eventId),
				eq(playerRoundStandings.roundId, roundId),
			));
		return { roundId, positions };
	};

	/**
	 * The Round Standings a Standings Screen's Position Change is measured
	 * against (#755): the nearest Round before `roundId`, in the Event's Round
	 * order, that holds Round Standings. Current standings (`roundId` null)
	 * compare with the Round before the latest one holding them.
	 *
	 * `null` when there is no such Round: the first Round, or a Round outside
	 * the Event.
	 */
	const findPreviousRoundPositions = async (
		eventId: number,
		roundId: number | null,
	): Promise<RoundStandingPositions | null> =>
		await findRoundPositions(eventId, previousStandingsRoundId(await listEventRounds(eventId), roundId));

	/**
	 * The Players a Phase's Top Cut Bracket seeds (#759), best Seed first, each
	 * by their current name: their positions in the Round Standings of the last
	 * Round before the Phase's first, in the Event's Round order, that holds
	 * them. None when no such Round exists, or the Phase holds no Round of the
	 * Event. A Player that Round gives no position has no Seed.
	 */
	const findSeededPlayers = async (eventId: number, phaseId: number): Promise<SeededPlayerRow[]> => {
		const roundId = seedingRoundId(await listEventRounds(eventId), phaseId);
		if (roundId == null)
			return [];
		const rows = await db
			.select({ playerId: playerRoundStandings.playerId, name: players.name, seed: playerRoundStandings.position })
			.from(playerRoundStandings)
			.innerJoin(players, eq(players.id, playerRoundStandings.playerId))
			.where(and(
				eq(playerRoundStandings.eventId, eventId),
				eq(playerRoundStandings.roundId, roundId),
				isNotNull(playerRoundStandings.position),
			))
			.orderBy(playerRoundStandings.position);
		return rows.flatMap(({ seed, ...row }) => seed == null
			? []
			: [
					{ ...row, seed },
				]);
	};

	return {
		findByRoundId,
		findPreviousRoundPositions,
		findSeededPlayers,
	};
}
