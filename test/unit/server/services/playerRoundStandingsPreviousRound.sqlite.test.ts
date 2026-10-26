import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * The previous Round's Round Standings a Standings Screen's Position Change is
 * measured against (#755), read against real SQL so the Event's Round order
 * (Phase sort order, then round number) is what the query really applies.
 */

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

vi.doMock('~~/server/db', () => ({ db }));

const { playerRoundStandingsService } = await import('~~/server/services/playerRoundStandings');

let eventId: number;
let otherEventId: number;
let otherRoundId: number;
const players: Record<'alpha' | 'beta' | 'gamma', number> = { alpha: 0, beta: 0, gamma: 0 };
const roundIds: Record<'day1r1' | 'day1r2' | 'day1r3' | 'day2r1', number> = {
	day1r1: 0,
	day1r2: 0,
	day1r3: 0,
	day2r1: 0,
};

async function insertEvent(name: string) {
	const [event] = await db.insert(schema.events)
		.values({ name, game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	return event!.id;
}

async function insertPhase(forEvent: number, name: string, sortOrder: number) {
	const [phase] = await db.insert(schema.phases)
		.values({ eventId: forEvent, name, sortOrder })
		.returning({ id: schema.phases.id });
	return phase!.id;
}

async function insertRound(forEvent: number, phaseId: number, roundNumber: number) {
	const [round] = await db.insert(schema.rounds)
		.values({
			eventId: forEvent,
			phaseId,
			name: `Round ${roundNumber}`,
			roundNumber,
		})
		.returning({ id: schema.rounds.id });
	return round!.id;
}

async function insertStandings(forEvent: number, roundId: number, positions: Array<[playerId: number, position: number | null]>) {
	await db.insert(schema.playerRoundStandings)
		.values(positions.map(([playerId, position]) => ({
			eventId: forEvent,
			playerId,
			roundId,
			position,
		})));
}

beforeAll(async () => {
	eventId = await insertEvent('Event');
	for (const name of ['alpha', 'beta', 'gamma'] as const) {
		const [player] = await db.insert(schema.players).values({ eventId, name }).returning({ id: schema.players.id });
		players[name] = player!.id;
	}

	// Day 2 is inserted first, and Day 1's Round 3 before its Round 1, so only
	// the Event's Round order, not insertion order, puts them in sequence.
	const day2 = await insertPhase(eventId, 'Day 2', 2);
	const day1 = await insertPhase(eventId, 'Day 1', 1);
	roundIds.day2r1 = await insertRound(eventId, day2, 1);
	roundIds.day1r3 = await insertRound(eventId, day1, 3);
	roundIds.day1r1 = await insertRound(eventId, day1, 1);
	// A Round with no Round Standings, such as a manual one.
	roundIds.day1r2 = await insertRound(eventId, day1, 2);

	await insertStandings(eventId, roundIds.day1r1, [
		[players.alpha, 1],
		[players.beta, 2],
	]);
	await insertStandings(eventId, roundIds.day1r3, [
		[players.beta, 1],
		[players.alpha, 2],
		[players.gamma, null],
	]);
	await insertStandings(eventId, roundIds.day2r1, [
		[players.gamma, 1],
		[players.beta, 2],
		[players.alpha, 3],
	]);

	// Another Event whose Round sorts between them on every non-Event predicate.
	otherEventId = await insertEvent('Other Event');
	const otherPhase = await insertPhase(otherEventId, 'Other Day', 1);
	otherRoundId = await insertRound(otherEventId, otherPhase, 2);
	const [otherPlayer] = await db.insert(schema.players).values({ eventId: otherEventId, name: 'other' }).returning({ id: schema.players.id });
	await insertStandings(otherEventId, otherRoundId, [
		[otherPlayer!.id, 1],
	]);
});

afterAll(async () => await harness.close());

describe('playerRoundStandingsService.findPreviousRoundPositions', () => {
	it('answers the Round Standings of the Round before the selected one', async () => {
		const previous = await playerRoundStandingsService().findPreviousRoundPositions(eventId, roundIds.day2r1);

		expect(previous?.roundId).toBe(roundIds.day1r3);
		expect(previous?.positions).toEqual(expect.arrayContaining([
			{ playerId: players.beta, position: 1 },
			{ playerId: players.alpha, position: 2 },
			{ playerId: players.gamma, position: null },
		]));
		expect(previous?.positions).toHaveLength(3);
	});

	it('passes over an earlier Round that holds no Round Standings', async () => {
		const previous = await playerRoundStandingsService().findPreviousRoundPositions(eventId, roundIds.day1r3);

		expect(previous?.roundId).toBe(roundIds.day1r1);
	});

	it('answers nothing for the Event\'s first Round', async () => {
		expect(await playerRoundStandingsService().findPreviousRoundPositions(eventId, roundIds.day1r1)).toBeNull();
	});

	it('measures current standings against the Round before the latest one holding Round Standings', async () => {
		const previous = await playerRoundStandingsService().findPreviousRoundPositions(eventId, null);

		expect(previous?.roundId).toBe(roundIds.day1r3);
	});

	it('answers nothing for a Round outside the asking Event', async () => {
		expect(await playerRoundStandingsService().findPreviousRoundPositions(eventId, otherRoundId)).toBeNull();
	});

	it('answers nothing for current standings in an Event with a single Round holding Round Standings', async () => {
		expect(await playerRoundStandingsService().findPreviousRoundPositions(otherEventId, null)).toBeNull();
	});
});
