import type { MeleeMatchParsed, MeleeStandingParsed } from '~~/server/schemas/external/melee';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { mapMeleePlayersToDb } from '~~/server/mappers/melee';
import { MeleeTransportError } from '~~/server/services/meleeTransport';
import { meleeCompetitor, meleeMatch, meleePlayer, meleeStanding } from '~~/test/helpers/meleeFixtures';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/*
 * A Live Results tick against real SQL: only Melee, Ably and the clock are stood in
 * for. It polls the Current Round, announces only what changed, and writes the
 * Event row only for poll state; the runner keeps one Event's failure from the rest.
 */

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

/** One fake Melee tournament per `meleeEventId`, so Events in one run differ. */
interface FakeTournament {
	matches: Map<number, MeleeMatchParsed[] | Error>;
	standings: Map<number, MeleeStandingParsed[]>;
	teamIds: number[];
	onFetchMatches?: () => Promise<void>;
}
const tournaments = new Map<string, FakeTournament>();
const meleeCalls = vi.fn();

function fakeMelee(meleeEventId: string) {
	const tournament = tournaments.get(meleeEventId)!;
	return {
		fetchMatchesByRound: async (roundId: number) => {
			meleeCalls(meleeEventId, 'matches', roundId);
			await tournament.onFetchMatches?.();
			const matches = tournament.matches.get(roundId) ?? [];
			if (matches instanceof Error)
				throw matches;
			return matches;
		},
		fetchStandingsByRound: async (roundId: number) => {
			meleeCalls(meleeEventId, 'standings', roundId);
			return tournament.standings.get(roundId) ?? [];
		},
		fetchEvent: async () => {
			meleeCalls(meleeEventId, 'event');
			return { Game: 'MagicTheGathering' };
		},
		fetchMergedPlayers: async () => {
			meleeCalls(meleeEventId, 'players');
			return mapMeleePlayersToDb(tournament.teamIds.map(teamId => meleePlayer(teamId)), []);
		},
	};
}

const publishMessage = vi.fn();
const publishMessageStrict = vi.fn();

vi.doMock('~~/server/db', () => ({ db }));
vi.doMock('~~/server/services/meleeIntegration', () => ({
	requireMeleeService: (eventData: { meleeEventId: string }) => fakeMelee(eventData.meleeEventId),
}));
vi.doMock('~~/server/utils/ably', () => ({
	getOriginConnectionId: () => 'origin-1',
	publishMessage,
	publishMessageStrict,
}));
vi.doMock('~~/server/modules/broadcast-graphics-live-session', () => ({
	refreshBroadcastGraphicsBindings: vi.fn(),
}));
vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('getValidatedRouterParams', async (event: { params: Record<string, string> }, parse: (value: unknown) => unknown) => parse(event.params));

const { runLiveResultsTick } = await import('~~/server/modules/melee-sync/liveResults/tick');
const { runDueLiveResultsTicks } = await import('~~/server/modules/melee-sync/liveResults/runner');
const { createMeleeSyncWorkflows } = await import('~~/server/modules/melee-sync/workflows');
const { acquireMeleeSyncLease } = await import('~~/server/utils/meleeSyncState');
const { default: getStatus } = await import('~~/server/api/events/[id]/melee/live-results.get');

afterAll(async () => await harness.close());

const now = new Date('2026-10-27T12:00:00.000Z');
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const secondsLater = (seconds: number, from = now) => new Date(from.getTime() + seconds * 1000);

/** Melee Round ids: Swiss Rounds 3 and 4. */
const ROUND_3 = 3003;
const ROUND_4 = 3004;
const GENERIC_FAILURE = 'Melee sync failed. Retry the operation.';

let tournamentCount = 0;

/**
 * An Event with Melee Sync and Live Results on, a Swiss Phase of Rounds 3 and 4,
 * and four Players imported from Melee. Its Melee tournament starts with no pairings.
 */
async function seedEvent(poll: Partial<typeof schema.events.$inferInsert> = {}) {
	const meleeEventId = `melee-${++tournamentCount}`;
	tournaments.set(meleeEventId, {
		matches: new Map(),
		standings: new Map(),
		teamIds: [1, 2, 3, 4],
	});
	const [event] = await db.insert(schema.events).values({
		name: 'Melee Championship',
		game: 'mtg',
		featureMatchOrientation: 'horizontal',
		meleeEnabled: true,
		meleeEventId,
		meleeLiveResultsEnabled: true,
		meleeLiveResultsLastChangeAt: minutesAgo(5),
		...poll,
	}).returning();
	const eventId = event!.id;
	const [swiss] = await db.insert(schema.phases).values({
		eventId,
		name: 'Swiss',
		sortOrder: 0,
		externalId: '40',
		externalSource: 'melee',
	}).returning();
	const [round3, round4] = await db.insert(schema.rounds).values([
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
	const tournament = tournaments.get(meleeEventId)!;
	return {
		eventId,
		swissId: swiss!.id,
		tournament,
		roundId: (meleeRoundId: number) => meleeRoundId === ROUND_3
			? round3!.id
			: round4!.id,
		/** Melee now holds `matches` (and `standings`) for a Round; a manual sync stored them. */
		async stage(meleeRoundId: number, matches: MeleeMatchParsed[], standings: MeleeStandingParsed[] = []) {
			tournament.matches.set(meleeRoundId, matches);
			tournament.standings.set(meleeRoundId, standings);
			const eventData = (await db.query.events.findFirst({
				where: eq(schema.events.id, eventId),
			}))!;
			await createMeleeSyncWorkflows().syncRoundMatches({}, eventId, eventData, meleeRoundId === ROUND_3
				? round3!.id
				: round4!.id);
			vi.clearAllMocks();
		},
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

const round3Standings = [1, 3, 2, 4].map((teamId, index) => meleeStanding(teamId, { Rank: index + 1 }));

async function pollState(eventId: number) {
	const event = (await db.query.events.findFirst({
		where: eq(schema.events.id, eventId),
	}))!;
	return {
		enabled: event.meleeLiveResultsEnabled,
		nextCheckAt: event.meleeLiveResultsNextCheckAt,
		backoffStep: event.meleeLiveResultsBackoffStep,
		lastCheckedAt: event.meleeLiveResultsLastCheckedAt,
		lastChangeAt: event.meleeLiveResultsLastChangeAt,
		error: event.meleeLiveResultsError,
		stopReason: event.meleeLiveResultsStopReason,
	};
}

async function matchesOf(eventId: number, roundId: number) {
	return await db.select().from(schema.matches).where(and(
		eq(schema.matches.eventId, eventId),
		eq(schema.matches.roundId, roundId),
	)).orderBy(schema.matches.sortOrder);
}

async function standingsCount(eventId: number, roundId: number) {
	const rows = await db.select().from(schema.playerRoundStandings).where(and(
		eq(schema.playerRoundStandings.eventId, eventId),
		eq(schema.playerRoundStandings.roundId, roundId),
	));
	return rows.length;
}

/** Each realtime message published so far, as `[eventId, type]`. */
function announced() {
	return [
		...publishMessage.mock.calls,
		...publishMessageStrict.mock.calls,
	]
		.map(([eventId, type]) => [eventId, type]);
}

function eventUpdates(eventId: number) {
	return publishMessage.mock.calls
		.filter(([id, type]) => id === eventId && type === 'event:updated')
		.map(([, , payload]) => payload.event);
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers({
		toFake: ['Date'],
	});
	vi.setSystemTime(now);
});

afterEach(() => vi.useRealTimers());

describe('a Live Results tick', () => {
	it('stores a newly reported Match Result and announces only it', async () => {
		const { eventId, roundId, stage, tournament } = await seedEvent();
		await stage(ROUND_3, [
			pairing('a', [1, 2]),
			pairing('b', [3, 4]),
		]);
		tournament.matches.set(ROUND_3, [
			pairing('a', [1, 2]),
			pairing('b', [3, 4], [2, 1]),
		]);

		const { outcome } = await runLiveResultsTick(eventId, now);

		const reported = (await matchesOf(eventId, roundId(ROUND_3))).find(match => match.externalId === 'b')!;
		expect(outcome).toBe('changed');
		expect(reported).toMatchObject({ hasResult: true, player1GameWins: 2, player2GameWins: 1 });
		expect(publishMessageStrict).toHaveBeenCalledWith(
			eventId,
			'melee:matchResultsSynced',
			{
				roundId: roundId(ROUND_3),
				matchIds: [reported.id],
			},
			undefined,
		);
		expect(eventUpdates(eventId)).toEqual([]);
		expect(await pollState(eventId)).toMatchObject({
			nextCheckAt: secondsLater(60),
			lastCheckedAt: now,
			lastChangeAt: now,
			error: null,
		});
	});

	it('records only when it last checked when Melee reports nothing new', async () => {
		const { eventId, stage } = await seedEvent();
		await stage(ROUND_3, [
			pairing('a', [1, 2], [2, 0]),
			pairing('b', [3, 4]),
		]);

		const { outcome } = await runLiveResultsTick(eventId, now);

		expect(outcome).toBe('unchanged');
		expect(await pollState(eventId)).toMatchObject({
			nextCheckAt: secondsLater(60),
			lastCheckedAt: now,
			lastChangeAt: minutesAgo(5),
			backoffStep: 0,
		});
	});

	it('asks Melee for the Current Round\'s Matches only, leaving the previous Round\'s missing standings to its first pairing', async () => {
		const { eventId, stage, tournament } = await seedEvent();
		await stage(ROUND_3, [
			pairing('a', [1, 2], [2, 0]),
			pairing('b', [3, 4]),
		]);
		await stage(ROUND_4, [
			pairing('c', [1, 3]),
			pairing('d', [2, 4]),
		]);
		tournament.standings.set(ROUND_3, round3Standings);

		await runLiveResultsTick(eventId, now);

		expect(meleeCalls.mock.calls.map(call => call.slice(1))).toEqual([
			['matches', ROUND_4],
		]);
	});

	it('takes up the next Round once Melee pairs it: Players refreshed, pairings stored, the previous Round\'s standings filled', async () => {
		const { eventId, roundId, stage, tournament } = await seedEvent({ meleeLiveResultsBackoffStep: 3 });
		// Round 3 completed while Melee still had no standings for it.
		await stage(ROUND_3, [
			pairing('a', [1, 2], [2, 0]),
			pairing('b', [3, 4], [2, 1]),
		]);
		tournament.standings.set(ROUND_3, round3Standings);
		tournament.teamIds = [1, 2, 3, 4, 5];
		tournament.matches.set(ROUND_4, [
			pairing('c', [1, 3]),
			pairing('d', [2, 5]),
		]);

		const { outcome } = await runLiveResultsTick(eventId, now);

		const newcomer = await db.query.players.findFirst({
			where: and(eq(schema.players.eventId, eventId), eq(schema.players.externalId, '5')),
		});
		const round4 = await matchesOf(eventId, roundId(ROUND_4));
		expect(outcome).toBe('changed');
		expect(round4.map(match => match.externalId)).toEqual(['c', 'd']);
		expect(round4[1]!.player2Id).toBe(newcomer!.id);
		expect(await standingsCount(eventId, roundId(ROUND_3))).toBe(4);
		expect(announced()).toEqual(expect.arrayContaining([
			[eventId, 'melee:pairingsSynced'],
			[eventId, 'melee:roundStandingsSynced'],
		]));
		expect(await pollState(eventId)).toMatchObject({
			backoffStep: 0,
			nextCheckAt: secondsLater(60),
			lastChangeAt: now,
		});
	});

	it.each([
		{
			case: 'answers 404',
			melee: new MeleeTransportError('Not found', 'http', 404),
		},
		{ case: 'has no Matches', melee: [] },
	])('backs off probing when Melee $case for the next Round', async ({ melee }) => {
		const { eventId, stage, tournament } = await seedEvent({ meleeLiveResultsBackoffStep: 2 });
		await stage(ROUND_3, [
			pairing('a', [1, 2], [2, 0]),
		], round3Standings);
		tournament.matches.set(ROUND_4, melee);

		const { outcome } = await runLiveResultsTick(eventId, now);

		expect(outcome).toBe('unchanged');
		expect(announced()).toEqual([]);
		expect(await pollState(eventId)).toMatchObject({
			backoffStep: 3,
			nextCheckAt: secondsLater(240),
			error: null,
		});
	});

	it('records a Melee failure once, backs off, and clears it on the next good tick', async () => {
		const { eventId, roundId, stage, tournament } = await seedEvent();
		await stage(ROUND_3, [
			pairing('a', [1, 2], [2, 0]),
			pairing('b', [3, 4]),
		]);
		const before = await matchesOf(eventId, roundId(ROUND_3));
		tournament.matches.set(ROUND_3, new MeleeTransportError('Upstream failed', 'http', 500));

		const first = await runLiveResultsTick(eventId, now);
		const afterFirst = await pollState(eventId);
		const second = await runLiveResultsTick(eventId, secondsLater(60));
		const afterSecond = await pollState(eventId);
		tournament.matches.set(ROUND_3, [
			pairing('a', [1, 2], [2, 0]),
			pairing('b', [3, 4]),
		]);
		const third = await runLiveResultsTick(eventId, secondsLater(180));

		expect([first.outcome, second.outcome, third.outcome]).toEqual(['failed', 'failed', 'unchanged']);
		expect(afterFirst).toMatchObject({
			error: GENERIC_FAILURE,
			backoffStep: 1,
			nextCheckAt: secondsLater(60),
		});
		expect(afterSecond).toMatchObject({
			error: GENERIC_FAILURE,
			backoffStep: 2,
			nextCheckAt: secondsLater(180),
		});
		expect(await pollState(eventId)).toMatchObject({
			error: null,
			backoffStep: 0,
			nextCheckAt: secondsLater(240),
		});
		expect(eventUpdates(eventId).map(event => event.meleeLiveResultsError)).toEqual([GENERIC_FAILURE, null]);
		expect(await matchesOf(eventId, roundId(ROUND_3))).toEqual(before);
	});

	it.each([
		{
			case: 'Melee refuses its credentials (401)',
			melee: new MeleeTransportError('Unauthorized', 'http', 401),
			lastChangeAt: minutesAgo(5),
			stopReason: 'auth',
		},
		{
			case: 'Melee forbids the tournament (403)',
			melee: new MeleeTransportError('Forbidden', 'http', 403),
			lastChangeAt: minutesAgo(5),
			stopReason: 'auth',
		},
		{
			case: 'nothing changed for over 12 hours',
			melee: null,
			lastChangeAt: minutesAgo(12 * 60 + 1),
			stopReason: 'idle',
		},
	])('stops itself when $case, and announces the Event once', async ({ melee, lastChangeAt, stopReason }) => {
		const { eventId, stage, tournament } = await seedEvent({ meleeLiveResultsLastChangeAt: lastChangeAt });
		await stage(ROUND_3, [
			pairing('a', [1, 2], [2, 0]),
			pairing('b', [3, 4]),
		]);
		if (melee)
			tournament.matches.set(ROUND_3, melee);

		const { outcome } = await runLiveResultsTick(eventId, now);

		expect(outcome).toBe('stopped');
		expect(await pollState(eventId)).toMatchObject({ enabled: false, stopReason, lastCheckedAt: now });
		expect(eventUpdates(eventId)).toEqual([
			expect.objectContaining({ meleeLiveResultsEnabled: false, meleeLiveResultsStopReason: stopReason }),
		]);
	});

	it('skips, touching nothing, while an operator\'s Melee Sync command holds the Event', async () => {
		const { eventId, stage } = await seedEvent();
		await stage(ROUND_3, [
			pairing('a', [1, 2], [2, 0]),
			pairing('b', [3, 4]),
		]);
		await acquireMeleeSyncLease(eventId, 'update');
		const before = await pollState(eventId);

		const { outcome } = await runLiveResultsTick(eventId, now);

		expect(outcome).toBe('skipped');
		expect(await pollState(eventId)).toEqual(before);
		expect(meleeCalls).not.toHaveBeenCalled();
		expect(announced()).toEqual([]);
	});

	// Whatever lands while Melee answers, the tick writes neither the Round nor
	// its poll state: an operator's command, or a setting switched off, wins.
	it.each([
		{
			case: 'an operator command takes the Event',
			meanwhile: async (eventId: number) => {
				await acquireMeleeSyncLease(eventId, 'update');
			},
		},
		{
			case: 'Live Results is switched off',
			meanwhile: async (eventId: number) => {
				await db.update(schema.events).set({ meleeLiveResultsEnabled: false }).where(eq(schema.events.id, eventId));
			},
		},
		{
			case: 'Melee Sync is switched off',
			meanwhile: async (eventId: number) => {
				await db.update(schema.events).set({ meleeEnabled: false }).where(eq(schema.events.id, eventId));
			},
		},
	])('abandons its write when $case mid-tick', async ({ meanwhile }) => {
		const { eventId, roundId, stage, tournament } = await seedEvent();
		await stage(ROUND_3, [
			pairing('a', [1, 2]),
			pairing('b', [3, 4]),
		]);
		const before = await matchesOf(eventId, roundId(ROUND_3));
		const pollBefore = await pollState(eventId);
		tournament.matches.set(ROUND_3, [
			pairing('a', [1, 2]),
			pairing('b', [3, 4], [2, 1]),
		]);
		tournament.onFetchMatches = async () => await meanwhile(eventId);

		const { outcome } = await runLiveResultsTick(eventId, now);

		expect(outcome).toBe('skipped');
		expect(await matchesOf(eventId, roundId(ROUND_3))).toEqual(before);
		expect(await pollState(eventId)).toMatchObject({
			nextCheckAt: pollBefore.nextCheckAt,
			lastCheckedAt: pollBefore.lastCheckedAt,
			error: null,
		});
		expect(announced()).toEqual([]);
	});

	it('abandons a probe\'s Player refresh when an operator command takes the Event mid-tick', async () => {
		const { eventId, roundId, stage, tournament } = await seedEvent();
		await stage(ROUND_3, [
			pairing('a', [1, 2], [2, 0]),
		], round3Standings);
		tournament.teamIds = [1, 2, 3, 4, 5];
		tournament.matches.set(ROUND_4, [
			pairing('c', [1, 5]),
		]);
		tournament.onFetchMatches = async () => {
			await acquireMeleeSyncLease(eventId, 'update');
		};

		const { outcome } = await runLiveResultsTick(eventId, now);

		const newcomer = await db.query.players.findFirst({
			where: and(eq(schema.players.eventId, eventId), eq(schema.players.externalId, '5')),
		});
		expect(outcome).toBe('skipped');
		expect(newcomer).toBeUndefined();
		expect(await matchesOf(eventId, roundId(ROUND_4))).toEqual([]);
	});

	it.each([
		{
			case: 'Live Results',
			values: { meleeLiveResultsEnabled: false },
		},
		{
			case: 'Melee Sync',
			values: { meleeEnabled: false },
		},
	])('skips, touching nothing, once $case is off', async ({ values }) => {
		const { eventId, stage } = await seedEvent();
		await stage(ROUND_3, [
			pairing('a', [1, 2], [2, 0]),
			pairing('b', [3, 4]),
		]);
		await db.update(schema.events).set(values).where(eq(schema.events.id, eventId));
		const before = await pollState(eventId);

		const { outcome } = await runLiveResultsTick(eventId, now);

		expect(outcome).toBe('skipped');
		expect(await pollState(eventId)).toEqual(before);
		expect(meleeCalls).not.toHaveBeenCalled();
	});
});

describe('the Live Results runner', () => {
	it.each([
		{
			case: 'Melee fails for the second',
			breakSecond: (second: Awaited<ReturnType<typeof seedEvent>>) => {
				second.tournament.matches.set(ROUND_3, new MeleeTransportError('Upstream failed', 'http', 500));
			},
			secondAfter: { error: GENERIC_FAILURE, backoffStep: 1 },
		},
		{
			case: 'the second is deleted mid-run',
			breakSecond: (second: Awaited<ReturnType<typeof seedEvent>>, first: Awaited<ReturnType<typeof seedEvent>>) => {
				first.tournament.onFetchMatches = async () => {
					await db.delete(schema.events).where(eq(schema.events.id, second.eventId));
				};
			},
			secondAfter: null,
		},
	])('ticks every due Event when $case', async ({ breakSecond, secondAfter }) => {
		await db.update(schema.events).set({ meleeLiveResultsEnabled: false });
		const seeded = [];
		for (const minutes of [3, 2, 1]) {
			const event = await seedEvent({
				meleeLiveResultsNextCheckAt: minutesAgo(minutes),
			});
			await event.stage(ROUND_3, [
				pairing('a', [1, 2], [2, 0]),
				pairing('b', [3, 4]),
			]);
			seeded.push(event);
		}
		const [first, second, third] = seeded as [typeof seeded[0], typeof seeded[0], typeof seeded[0]];
		breakSecond(second, first);

		await runDueLiveResultsTicks(now);

		expect(await pollState(first.eventId)).toMatchObject({ lastCheckedAt: now, error: null });
		expect(await pollState(third.eventId)).toMatchObject({ lastCheckedAt: now, error: null });
		if (secondAfter)
			expect(await pollState(second.eventId)).toMatchObject({ lastCheckedAt: now, ...secondAfter });
		expect(await matchesOf(first.eventId, first.roundId(ROUND_3))).toHaveLength(2);
	});

	it('leaves an Event alone until its next check is due', async () => {
		await db.update(schema.events).set({ meleeLiveResultsEnabled: false });
		const { eventId, stage } = await seedEvent({
			meleeLiveResultsNextCheckAt: secondsLater(30),
		});
		await stage(ROUND_3, [
			pairing('a', [1, 2], [2, 0]),
			pairing('b', [3, 4]),
		]);
		const before = await pollState(eventId);

		await runDueLiveResultsTicks(now);

		expect(await pollState(eventId)).toEqual(before);
		expect(meleeCalls).not.toHaveBeenCalled();
	});
});

describe('gET /api/events/:id/melee/live-results', () => {
	it('names the Current Round and the stored Live Results error', async () => {
		const { eventId, swissId, roundId, stage } = await seedEvent({
			meleeLiveResultsLastCheckedAt: minutesAgo(1),
			meleeLiveResultsError: GENERIC_FAILURE,
		});
		await stage(ROUND_3, [
			pairing('a', [1, 2], [2, 0]),
			pairing('b', [3, 4]),
		]);

		const status = await getStatus({
			params: {
				id: String(eventId),
			},
		} as never);

		expect(status).toEqual({
			enabled: true,
			currentRound: {
				id: roundId(ROUND_3),
				name: 'Round 3',
				phaseId: swissId,
				phaseName: 'Swiss',
			},
			lastCheckedAt: minutesAgo(1),
			lastChangeAt: minutesAgo(5),
			error: GENERIC_FAILURE,
			stopReason: null,
		});
	});
});
