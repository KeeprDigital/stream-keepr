import type { MeleeMatchParsed, MeleeStandingParsed } from '~~/server/schemas/external/melee';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { meleeCompetitor, meleeMatch, meleeStanding } from '~~/test/helpers/meleeFixtures';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/*
 * Round Match import against real SQL: only Melee and Ably are stood in for.
 * Round Standings are stored only for a complete Round, on every sync path, and a
 * Round sync announces only what it changed.
 */

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

const meleeMatchesByRound = new Map<number, MeleeMatchParsed[]>();
const meleeStandingsByRound = new Map<number, MeleeStandingParsed[]>();
const publishMessageStrict = vi.fn();
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
	publishMessageStrict,
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

/** Each realtime message published so far, as `[type, payload]`. */
function announced() {
	return publishMessageStrict.mock.calls.map(([, type, payload]) => [type, payload]);
}

beforeEach(() => {
	vi.clearAllMocks();
	meleeMatchesByRound.clear();
	meleeStandingsByRound.clear();
	melee.fetchStandingsByRound.mockImplementation(async (roundId: number) => meleeStandingsByRound.get(roundId) ?? []);
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

describe('the Player records a Round\'s Matches carry', () => {
	// Mid-Round, a Match side carries its Player's record going into the Round:
	// the previous Round's stored Round Standings. Once complete, the Round's own.
	const round4After = [
		meleeStanding(1, { Rank: 1, MatchWins: 4, Points: 12 }),
		meleeStanding(3, {
			Rank: 2,
			MatchWins: 3,
			MatchLosses: 1,
			Points: 9,
		}),
		meleeStanding(2, {
			Rank: 3,
			MatchWins: 1,
			MatchLosses: 3,
			Points: 3,
		}),
		meleeStanding(4, { Rank: 4, MatchLosses: 4 }),
	];

	it.each([
		{
			case: 'an incomplete Round carries the previous Round\'s stored records',
			round3Standings: standingsAfter,
			round4: [
				pairing('c', [1, 3]),
				pairing('d', [2, 4], [2, 0]),
			],
			player1: {
				wins: 3,
				losses: 0,
				draws: 0,
				position: 1,
				points: 9,
			},
			player3: {
				wins: 2,
				losses: 1,
				draws: 0,
				position: 2,
				points: 6,
			},
		},
		{
			case: 'an incomplete Round after one with no stored standings carries none',
			round3Standings: [],
			round4: [
				pairing('c', [1, 3]),
				pairing('d', [2, 4], [2, 0]),
			],
			player1: {
				wins: null,
				losses: null,
				draws: null,
				position: null,
				points: null,
			},
			player3: {
				wins: null,
				losses: null,
				draws: null,
				position: null,
				points: null,
			},
		},
		{
			case: 'a complete Round carries its own fetched records',
			round3Standings: standingsAfter,
			round4: [
				pairing('c', [1, 3], [2, 1]),
				pairing('d', [2, 4], [2, 0]),
			],
			player1: {
				wins: 4,
				losses: 0,
				draws: 0,
				position: 1,
				points: 12,
			},
			player3: {
				wins: 3,
				losses: 1,
				draws: 0,
				position: 2,
				points: 9,
			},
		},
	])('$case', async ({ round3Standings, round4, player1, player3 }) => {
		const { eventId, roundId } = await seedEvent();
		meleeMatchesByRound.set(ROUND_3, [
			pairing('a', [1, 2], [2, 0]),
			pairing('b', [3, 4], [2, 1]),
		]);
		meleeStandingsByRound.set(ROUND_3, round3Standings);
		await syncRound(eventId, roundId(ROUND_3));
		meleeMatchesByRound.set(ROUND_4, round4);
		meleeStandingsByRound.set(ROUND_4, round4After);

		await syncRound(eventId, roundId(ROUND_4));

		const tableC = (await matchesOf(eventId, roundId(ROUND_4))).find(match => match.externalId === 'c')!;
		expect(tableC.player1Data).toMatchObject(player1);
		expect(tableC.player2Data).toMatchObject(player3);
	});

	it('stores no Round Standings for an incomplete Round whose Matches carry the previous Round\'s', async () => {
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

		await syncRound(eventId, roundId(ROUND_4));

		expect(await standingsOf(eventId, roundId(ROUND_4))).toEqual([]);
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

	// Polling re-syncs the Current Round every minute, so it fills the previous
	// Round's standings only with the first pairings; a manual sync always heals.
	it.each([
		{
			case: 'a first pairing under onFirstPairing fills them',
			firstPairing: true,
			option: 'onFirstPairing',
			fills: true,
		},
		{
			case: 'a re-sync under onFirstPairing leaves them',
			firstPairing: false,
			option: 'onFirstPairing',
			fills: false,
		},
		{
			case: 'a re-sync by default fills them',
			firstPairing: false,
			option: undefined,
			fills: true,
		},
	] as const)('the previous Round\'s missing Round Standings: $case', async ({ firstPairing, option, fills }) => {
		const { eventId, roundId } = await seedEvent();
		meleeMatchesByRound.set(ROUND_3, [
			pairing('a', [1, 2], [2, 0]),
			pairing('b', [3, 4]),
		]);
		await syncRound(eventId, roundId(ROUND_3));
		meleeMatchesByRound.set(ROUND_4, [
			pairing('c', [1, 3]),
			pairing('d', [2, 4]),
		]);
		const workflows = createMeleeSyncWorkflows();
		// Melee had no standings for Round 3 when Round 4 was first paired.
		if (!firstPairing)
			await workflows.syncRoundMatches({}, eventId, eventData, roundId(ROUND_4));
		meleeStandingsByRound.set(ROUND_3, standingsAfter);
		melee.fetchMatchesByRound.mockClear();

		const result = await workflows.syncRoundMatches({}, eventId, eventData, roundId(ROUND_4), option && {
			previousRoundStandings: option,
		});

		expect((await standingsOf(eventId, roundId(ROUND_3))).length).toBe(fills
			? 4
			: 0);
		expect(result.previousRoundStandings != null).toBe(fills);
		expect(melee.fetchMatchesByRound.mock.calls.some(([id]) => id === ROUND_3)).toBe(fills);
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

describe('a Round sync announces only what it changed', () => {
	type Seeded = Awaited<ReturnType<typeof seedEvent>>;
	const matchId = async ({ eventId, roundId }: Seeded, meleeRoundId: number, guid: string) =>
		(await matchesOf(eventId, roundId(meleeRoundId))).find(match => match.externalId === guid)!.id;

	// `before` is Melee's Round 3 at the last sync; `after` is what Melee lists now.
	it.each([
		{
			case: 'nothing changed',
			before: [
				pairing('a', [1, 2], [2, 0]),
				pairing('b', [3, 4]),
			],
			after: [
				pairing('a', [1, 2], [2, 0]),
				pairing('b', [3, 4]),
			],
			published: [],
			expected: async () => [],
		},
		{
			case: 'one Match Result reported',
			before: [
				pairing('a', [1, 2]),
				pairing('b', [3, 4]),
			],
			after: [
				pairing('a', [1, 2], [2, 0]),
				pairing('b', [3, 4]),
			],
			published: ['matchResults'],
			expected: async (seeded: Seeded) => [
				[
					'melee:matchResultsSynced',
					{
						roundId: seeded.roundId(ROUND_3),
						matchIds: [await matchId(seeded, ROUND_3, 'a')],
					},
				],
			],
		},
		{
			case: 'a Match paired',
			before: [
				pairing('a', [1, 2]),
			],
			after: [
				pairing('a', [1, 2]),
				pairing('b', [3, 4]),
			],
			published: ['pairings'],
			expected: async (seeded: Seeded) => [
				[
					'melee:pairingsSynced',
					{
						roundId: seeded.roundId(ROUND_3),
					},
				],
			],
		},
		{
			// Completion re-maps each side's Player record, so pairings change with it.
			case: 'the final Match Result completes the Round',
			before: [
				pairing('a', [1, 2], [2, 0]),
				pairing('b', [3, 4]),
			],
			after: [
				pairing('a', [1, 2], [2, 0]),
				pairing('b', [3, 4], [2, 1]),
			],
			published: ['matchResults', 'pairings', 'roundStandings'],
			expected: async (seeded: Seeded) => [
				[
					'melee:matchResultsSynced',
					{
						roundId: seeded.roundId(ROUND_3),
						matchIds: [await matchId(seeded, ROUND_3, 'b')],
					},
				],
				[
					'melee:pairingsSynced',
					{
						roundId: seeded.roundId(ROUND_3),
					},
				],
				[
					'melee:roundStandingsSynced',
					{
						roundId: seeded.roundId(ROUND_3),
					},
				],
			],
		},
	])('$case: publishes $published', async ({ before, after, published, expected }) => {
		const seeded = await seedEvent();
		meleeMatchesByRound.set(ROUND_3, before);
		meleeStandingsByRound.set(ROUND_3, standingsAfter);
		await syncRound(seeded.eventId, seeded.roundId(ROUND_3));
		meleeMatchesByRound.set(ROUND_3, after);

		const result = await createMeleeSyncWorkflows().syncRoundMatches({}, seeded.eventId, eventData, seeded.roundId(ROUND_3));

		const messages = await expected(seeded);
		expect(result.published).toEqual(published);
		// The legacy summary follows any granular message, and only then.
		expect(announced()).toEqual(messages.length > 0
			? [
					...messages,
					[
						'melee:roundSynced',
						expect.objectContaining({
							roundId: seeded.roundId(ROUND_3),
						}),
					],
				]
			: []);
	});

	// Pairing Round 4 stores Round 3's standings, which re-syncs Round 3's Matches:
	// each side's Player record gains them, and a late-reported result lands too.
	it.each([
		{
			case: 'Round 3 otherwise unchanged',
			round3After: [
				pairing('a', [1, 2], [2, 0]),
				pairing('b', [3, 4]),
			],
			published: ['pairings', 'roundStandings'],
			round3Messages: async () => [],
		},
		{
			case: 'Round 3\'s last result reported meanwhile',
			round3After: [
				pairing('a', [1, 2], [2, 0]),
				pairing('b', [3, 4], [2, 1]),
			],
			published: ['matchResults', 'pairings', 'roundStandings'],
			round3Messages: async (seeded: Seeded) => [
				[
					'melee:matchResultsSynced',
					{
						roundId: seeded.roundId(ROUND_3),
						matchIds: [await matchId(seeded, ROUND_3, 'b')],
					},
				],
			],
		},
	])('announces the previous Round\'s changes under its own id when the next Round\'s pairings store its standings: $case', async ({ round3After, published, round3Messages }) => {
		const seeded = await seedEvent();
		meleeMatchesByRound.set(ROUND_3, [
			pairing('a', [1, 2], [2, 0]),
			pairing('b', [3, 4]),
		]);
		meleeStandingsByRound.set(ROUND_3, standingsAfter);
		await syncRound(seeded.eventId, seeded.roundId(ROUND_3));
		meleeMatchesByRound.set(ROUND_3, round3After);
		meleeMatchesByRound.set(ROUND_4, [
			pairing('c', [1, 3]),
			pairing('d', [2, 4]),
		]);

		const result = await createMeleeSyncWorkflows().syncRoundMatches({}, seeded.eventId, eventData, seeded.roundId(ROUND_4));

		expect(result.published).toEqual(published);
		expect(announced()).toEqual([
			[
				'melee:pairingsSynced',
				{
					roundId: seeded.roundId(ROUND_4),
				},
			],
			...await round3Messages(seeded),
			[
				'melee:pairingsSynced',
				{
					roundId: seeded.roundId(ROUND_3),
				},
			],
			[
				'melee:roundStandingsSynced',
				{
					roundId: seeded.roundId(ROUND_3),
				},
			],
			[
				'melee:roundSynced',
				expect.objectContaining({
					roundId: seeded.roundId(ROUND_4),
				}),
			],
		]);
	});

	it('still announces the Round\'s own changes, with a warning, when storing the previous Round\'s Round Standings fails', async () => {
		const seeded = await seedEvent();
		meleeMatchesByRound.set(ROUND_3, [
			pairing('a', [1, 2], [2, 0]),
			pairing('b', [3, 4]),
		]);
		await syncRound(seeded.eventId, seeded.roundId(ROUND_3));
		meleeMatchesByRound.set(ROUND_4, [
			pairing('c', [1, 3]),
			pairing('d', [2, 4]),
		]);
		melee.fetchStandingsByRound.mockRejectedValue(new Error('Melee unavailable'));
		vi.spyOn(console, 'warn').mockImplementation(() => {});

		const result = await createMeleeSyncWorkflows().syncRoundMatches({}, seeded.eventId, eventData, seeded.roundId(ROUND_4));

		expect(result).toMatchObject({
			published: ['pairings'],
			previousRoundStandings: null,
			warnings: [
				expect.stringContaining('previous Round\'s Round Standings could not be stored'),
			],
		});
		expect(await matchesOf(seeded.eventId, seeded.roundId(ROUND_4))).toHaveLength(2);
		expect(announced()).toEqual([
			[
				'melee:pairingsSynced',
				{
					roundId: seeded.roundId(ROUND_4),
				},
			],
			[
				'melee:roundSynced',
				expect.objectContaining({
					roundId: seeded.roundId(ROUND_4),
				}),
			],
		]);
	});
});
