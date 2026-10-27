import type { MeleeMatchParsed, MeleeStandingParsed } from '~~/server/schemas/external/melee';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { meleeCompetitor, meleeMatch, meleeStanding } from '~~/test/helpers/meleeFixtures';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/*
 * Round Match import against real SQL: only Melee and Ably are stood in for.
 * Round Standings are stored only for a complete Round, on every sync path.
 */

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

const meleeMatchesByRound = new Map<number, MeleeMatchParsed[]>();
const meleeStandingsByRound = new Map<number, MeleeStandingParsed[]>();
const melee = {
	fetchMatchesByRound: vi.fn(async (roundId: number) => meleeMatchesByRound.get(roundId) ?? []),
	fetchStandingsByRound: vi.fn(async (roundId: number) => meleeStandingsByRound.get(roundId) ?? []),
};

vi.doMock('~~/server/db', () => ({ db }));
vi.doMock('~~/server/services/meleeIntegration', () => ({
	requireMeleeService: () => melee,
}));
vi.doMock('~~/server/utils/ably', () => ({
	getOriginConnectionId: () => 'origin-1',
	publishMessage: vi.fn(),
	publishMessageStrict: vi.fn(),
}));
vi.doMock('~~/server/modules/broadcast-graphics-live-session', () => ({
	refreshBroadcastGraphicsBindings: vi.fn(),
}));

const { MeleeRoundNotReadyError, syncMatchesFromMelee } = await import('~~/server/modules/melee-sync/roundMatches');
const { createMeleeSyncWorkflows } = await import('~~/server/modules/melee-sync/workflows');

afterAll(async () => await harness.close());

const eventData = {
	game: 'mtg' as const,
	meleeEnabled: true,
	meleeEventId: 'melee-1',
	meleeClientId: null,
	meleeClientSecret: null,
};

/** Melee Round ids: Swiss Rounds 3 and 4, then the first Top Cut Round. */
const ROUND_3 = 3003;
const ROUND_4 = 3004;
const QUARTERFINALS = 4001;

/** A Swiss Phase holding Rounds 3 and 4, a Top Cut Phase after it, and four Players imported from Melee. */
async function seedEvent() {
	const [event] = await db.insert(schema.events).values({
		name: 'Melee Championship',
		game: 'mtg',
		featureMatchOrientation: 'horizontal',
		meleeEnabled: true,
		meleeEventId: 'melee-1',
	}).returning({ id: schema.events.id });
	const eventId = event!.id;
	// Inserted Top Cut first, so Round order is the Phase sort order's, not insertion's.
	const [topCut, swiss] = await db.insert(schema.phases).values([
		{
			eventId,
			name: 'Top Cut',
			sortOrder: 1,
			externalId: '41',
			externalSource: 'melee',
		},
		{
			eventId,
			name: 'Swiss',
			sortOrder: 0,
			externalId: '40',
			externalSource: 'melee',
		},
	]).returning();
	const [quarterfinals, round3, round4] = await db.insert(schema.rounds).values([
		{
			eventId,
			phaseId: topCut!.id,
			name: 'Quarterfinals',
			roundNumber: 1,
			externalId: String(QUARTERFINALS),
			externalSource: 'melee',
		},
		{
			eventId,
			phaseId: swiss!.id,
			name: 'Round 3',
			roundNumber: 3,
			externalId: String(ROUND_3),
			externalSource: 'melee',
		},
		{
			eventId,
			phaseId: swiss!.id,
			name: 'Round 4',
			roundNumber: 4,
			externalId: String(ROUND_4),
			externalSource: 'melee',
		},
	]).returning();
	await db.insert(schema.players).values([1, 2, 3, 4].map(teamId => ({
		eventId,
		name: `Player ${teamId}`,
		externalId: String(teamId),
		externalSource: 'melee' as const,
	})));
	const roundIds = new Map([
		[ROUND_3, round3!.id],
		[ROUND_4, round4!.id],
		[QUARTERFINALS, quarterfinals!.id],
	]);
	return {
		eventId,
		roundId: (meleeRoundId: number) => roundIds.get(meleeRoundId)!,
	};
}

/** A Match between two Players; `result` reports it with that Game Score. */
function pairing(guid: string, teamIds: [number, number], result?: [number, number]) {
	return meleeMatch(guid, {
		TableNumber: teamIds[0],
		HasResult: result != null,
		Competitors: [
			meleeCompetitor(teamIds[0], { SortOrder: 0, GameWins: result?.[0] ?? null }),
			meleeCompetitor(teamIds[1], { SortOrder: 1, GameWins: result?.[1] ?? null }),
		],
	});
}

const standingsAfter = [
	meleeStanding(1, { Rank: 1, MatchWins: 3, Points: 9 }),
	meleeStanding(3, {
		Rank: 2,
		MatchWins: 2,
		MatchLosses: 1,
		Points: 6,
	}),
	meleeStanding(2, {
		Rank: 3,
		MatchWins: 1,
		MatchLosses: 2,
		Points: 3,
	}),
	meleeStanding(4, { Rank: 4, MatchLosses: 3 }),
];

async function syncRound(eventId: number, roundId: number) {
	const round = (await db.query.rounds.findFirst({
		where: eq(schema.rounds.id, roundId),
	}))!;
	const phase = (await db.query.phases.findFirst({
		where: eq(schema.phases.id, round.phaseId),
	}))!;
	return await syncMatchesFromMelee(eventId, eventData, round, phase);
}

async function standingsOf(eventId: number, roundId: number) {
	const rows = await db.select().from(schema.playerRoundStandings).where(and(
		eq(schema.playerRoundStandings.eventId, eventId),
		eq(schema.playerRoundStandings.roundId, roundId),
	)).orderBy(schema.playerRoundStandings.position);
	return rows.map(row => ({ position: row.position, points: row.points, updatedAt: row.updatedAt }));
}

async function matchesOf(eventId: number, roundId: number) {
	return await db.select().from(schema.matches).where(and(
		eq(schema.matches.eventId, eventId),
		eq(schema.matches.roundId, roundId),
	)).orderBy(schema.matches.sortOrder);
}

beforeEach(() => {
	vi.clearAllMocks();
	meleeMatchesByRound.clear();
	meleeStandingsByRound.clear();
});

describe('syncing a Round from Melee', () => {
	it('stores an in-progress Round\'s Matches but not its Round Standings, without asking Melee for them', async () => {
		const { eventId, roundId } = await seedEvent();
		meleeMatchesByRound.set(ROUND_3, [
			pairing('a', [1, 2], [2, 0]),
			pairing('b', [3, 4]),
		]);
		meleeStandingsByRound.set(ROUND_3, standingsAfter);

		const result = await syncRound(eventId, roundId(ROUND_3));

		expect(result).toMatchObject({ complete: false, matchCount: 2, standingsChanged: false });
		expect(await matchesOf(eventId, roundId(ROUND_3))).toHaveLength(2);
		expect(await standingsOf(eventId, roundId(ROUND_3))).toEqual([]);
		expect(melee.fetchStandingsByRound).not.toHaveBeenCalled();
	});

	it('stores Round Standings once the final Match Result arrives, naming that Match', async () => {
		const { eventId, roundId } = await seedEvent();
		meleeMatchesByRound.set(ROUND_3, [
			pairing('a', [1, 2], [2, 0]),
			pairing('b', [3, 4]),
		]);
		meleeStandingsByRound.set(ROUND_3, standingsAfter);
		await syncRound(eventId, roundId(ROUND_3));
		meleeMatchesByRound.set(ROUND_3, [
			pairing('a', [1, 2], [2, 0]),
			pairing('b', [3, 4], [2, 1]),
		]);

		const result = await syncRound(eventId, roundId(ROUND_3));

		const tableB = (await matchesOf(eventId, roundId(ROUND_3))).find(match => match.externalId === 'b')!;
		expect(result).toMatchObject({
			complete: true,
			standingsChanged: true,
			resultChangedMatchIds: [tableB.id],
		});
		expect((await standingsOf(eventId, roundId(ROUND_3))).map(row => row.position)).toEqual([1, 2, 3, 4]);
	});

	it('leaves a complete Round\'s Round Standings untouched when Melee un-reports one of its Match Results', async () => {
		const { eventId, roundId } = await seedEvent();
		meleeMatchesByRound.set(ROUND_3, [
			pairing('a', [1, 2], [2, 0]),
			pairing('b', [3, 4], [2, 1]),
		]);
		meleeStandingsByRound.set(ROUND_3, standingsAfter);
		await syncRound(eventId, roundId(ROUND_3));
		const storedStandings = await standingsOf(eventId, roundId(ROUND_3));
		meleeMatchesByRound.set(ROUND_3, [
			pairing('a', [1, 2], [2, 0]),
			pairing('b', [3, 4]),
		]);
		meleeStandingsByRound.set(ROUND_3, standingsAfter.slice().reverse().map((standing, index) => ({ ...standing, Rank: index + 1 })));

		const result = await syncRound(eventId, roundId(ROUND_3));

		const tableB = (await matchesOf(eventId, roundId(ROUND_3))).find(match => match.externalId === 'b')!;
		expect(tableB).toMatchObject({ hasResult: false, player1GameWins: null });
		expect(result).toMatchObject({
			complete: false,
			standingsChanged: false,
			resultChangedMatchIds: [tableB.id],
		});
		expect(await standingsOf(eventId, roundId(ROUND_3))).toEqual(storedStandings);
	});

	it('refuses a never-synced Round Melee lists no Matches for as not ready, even when Melee lists standings', async () => {
		const { eventId, roundId } = await seedEvent();
		meleeStandingsByRound.set(ROUND_4, standingsAfter);

		await expect(syncRound(eventId, roundId(ROUND_4))).rejects.toBeInstanceOf(MeleeRoundNotReadyError);

		expect(await matchesOf(eventId, roundId(ROUND_4))).toEqual([]);
		expect(await standingsOf(eventId, roundId(ROUND_4))).toEqual([]);
		expect((await db.query.rounds.findFirst({
			where: eq(schema.rounds.id, roundId(ROUND_4)),
		}))!.lastSyncedAt).toBeNull();
	});
});

describe('pairing the next Round completes the one before it', () => {
	// The last Swiss Round's standings seed the Top Cut, so the Phase boundary counts as Round order too.
	it.each([
		{ case: 'within a Phase', previous: ROUND_3, next: ROUND_4 },
		{ case: 'across a Phase boundary', previous: ROUND_4, next: QUARTERFINALS },
	])('$case: stores the previous Round\'s Round Standings when the next Round\'s pairings arrive', async ({ previous, next }) => {
		const { eventId, roundId } = await seedEvent();
		// The previous Round is stuck on a Match Melee never reports.
		meleeMatchesByRound.set(previous, [
			pairing('a', [1, 2], [2, 0]),
			pairing('b', [3, 4]),
		]);
		meleeStandingsByRound.set(previous, standingsAfter);
		await syncRound(eventId, roundId(previous));
		meleeMatchesByRound.set(next, [
			pairing('c', [1, 3]),
			pairing('d', [2, 4]),
		]);

		const result = await createMeleeSyncWorkflows().syncRoundMatches({}, eventId, eventData, roundId(next));

		expect(result).toMatchObject({
			complete: false,
			previousRoundStandings: {
				roundId: roundId(previous),
				standingsChanged: true,
			},
		});
		expect((await standingsOf(eventId, roundId(previous))).map(row => row.position)).toEqual([1, 2, 3, 4]);
		expect(await standingsOf(eventId, roundId(next))).toEqual([]);
		expect(await syncRound(eventId, roundId(previous))).toMatchObject({ complete: true });
	});

	it('leaves a previous Round already holding Round Standings alone', async () => {
		const { eventId, roundId } = await seedEvent();
		meleeMatchesByRound.set(ROUND_3, [
			pairing('a', [1, 2], [2, 0]),
			pairing('b', [3, 4], [2, 1]),
		]);
		meleeStandingsByRound.set(ROUND_3, standingsAfter);
		await syncRound(eventId, roundId(ROUND_3));
		meleeMatchesByRound.set(ROUND_4, [
			pairing('c', [1, 3]),
			pairing('d', [2, 4]),
		]);
		melee.fetchMatchesByRound.mockClear();

		const result = await createMeleeSyncWorkflows().syncRoundMatches({}, eventId, eventData, roundId(ROUND_4));

		expect(result.previousRoundStandings).toBeNull();
		expect(melee.fetchMatchesByRound.mock.calls).toEqual([
			[ROUND_4],
		]);
	});
});
