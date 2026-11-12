import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { mapMeleePlayersToDb } from '~~/server/mappers/melee';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { lastCallTo } from '~~/test/helpers/lastCallTo';
import { meleeCompetitor, meleeMatch, meleePlayer } from '~~/test/helpers/meleeFixtures';
import { providerRefusal } from '~~/test/helpers/providerRefusal';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/*
 * The Melee Sync commands that run several stages, against real SQL: what each
 * refuses, which stages it runs, and what they leave stored. Only Melee, the card
 * provider and Ably are stood in for; a lost Session race is forced on the real service.
 */

vi.stubGlobal('createError', (input: { statusCode: number; message?: string; statusMessage?: string; data?: unknown }) =>
	Object.assign(new Error(input.message ?? input.statusMessage), input));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

const melee = {
	fetchEvent: vi.fn(),
	fetchPlayers: vi.fn(),
	fetchCurrentStandings: vi.fn(),
	fetchMergedPlayers: vi.fn(),
	fetchMatchesByRound: vi.fn(),
	fetchStandingsByRound: vi.fn(),
};
const publishMessage = vi.fn();
/** Thrown by the next Session correction instead of applying it. */
let failNextCorrection: unknown;

vi.doMock('~~/server/db', () => ({ db }));
vi.doMock('~~/server/services/meleeIntegration', () => ({
	requireMeleeService: () => melee,
}));
vi.doMock('~~/server/services/importedMtgCardResolver', () => ({
	importedMtgCardResolverService: () => ({
		resolveBatch: async () => ({
			resolutions: new Map(),
		}),
	}),
}));
vi.doMock('~~/server/utils/ably', () => ({
	getOriginConnectionId: () => 'origin-1',
	publishMessage,
	publishMessageStrict: publishMessage,
	publishScreenCommand: async () => {},
}));
vi.doMock('~~/server/modules/broadcast-graphics-live-session', async importOriginal => ({
	...await importOriginal<object>(),
	refreshBroadcastGraphicsBindings: async () => {},
}));
vi.doMock('~~/server/services/featureMatchState', async (importOriginal) => {
	const actual = await importOriginal<typeof import('~~/server/services/featureMatchState')>();
	return {
		...actual,
		featureMatchStateService: () => {
			const service = actual.featureMatchStateService();
			return {
				...service,
				applyCommandToActiveSession: async (...args: Parameters<typeof service.applyCommandToActiveSession>) => {
					const failure = failNextCorrection;
					failNextCorrection = undefined;
					if (failure)
						throw failure;
					return await service.applyCommandToActiveSession(...args);
				},
			};
		},
	};
});

const { meleeSyncModule } = await import('~~/server/modules/melee-sync');

afterAll(async () => await harness.close());

const requestEvent = stubH3Event();
const EARLIER = new Date('2026-01-01T00:00:00.000Z');

/** Melee's tournament: a Swiss Phase of two Rounds, and four Players, the first with a Deck List. */
const tournament = {
	ID: 1,
	Name: 'Melee Championship',
	Game: 'Magic: The Gathering',
	Phases: [
		{
			ID: 10,
			Name: 'Swiss',
			FormatId: 'modern',
			SortOrder: 0,
			Rounds: [
				{ ID: 101, Name: 'Round 1', SortOrder: 0 },
				{ ID: 102, Name: 'Round 2', SortOrder: 1 },
			],
		},
	],
};
const tournamentPlayers = [1, 2, 3, 4].map(teamId => meleePlayer(teamId, teamId === 1
	? {
			Decklists: [
				{
					Guid: 'deck-burn',
					FormatId: 'modern',
					DecklistName: 'Burn',
					Records: [],
					Attributes: [],
				},
			],
		}
	: {}));

/** A Round's unreported pairings: Players 1 and 2, and 3 and 4. */
function pairings(meleeRoundId: number) {
	return [
		[1, 2] as const,
		[3, 4] as const,
	].map(([first, second]) => meleeMatch(`${meleeRoundId}-${first}`, {
		TableNumber: first,
		HasResult: false,
		Competitors: [
			meleeCompetitor(first, { SortOrder: 0 }),
			meleeCompetitor(second, { SortOrder: 1 }),
		],
	}));
}

async function createEvent(values: Partial<typeof schema.events.$inferInsert> = {}) {
	const [event] = await db.insert(schema.events).values({
		name: 'Melee Championship',
		game: 'mtg',
		featureMatchOrientation: 'horizontal',
		meleeEnabled: true,
		meleeEventId: 'melee-1',
		...values,
	}).returning({ id: schema.events.id });
	return event!.id;
}

/**
 * The tournament as an earlier sync stored it. A `synced` Round was paired then
 * and holds its Round Standings, though no Match, so a refresh of it shows.
 */
async function seedTournament({ synced, deckListsSynced }: { synced: readonly string[]; deckListsSynced: boolean }) {
	const eventId = await createEvent({
		lastDecklistsSyncedAt: deckListsSynced
			? EARLIER
			: null,
	});
	const [phase] = await db.insert(schema.phases).values({
		eventId,
		name: 'Swiss',
		sortOrder: 0,
		externalId: '10',
		externalSource: 'melee',
		formatExternalId: 'modern',
	}).returning();
	const players = await db.insert(schema.players).values(tournamentPlayers.map(player => ({
		eventId,
		name: player.PlayerName,
		externalId: String(player.TeamId),
		externalSource: 'melee' as const,
	}))).returning();
	for (const [index, round] of tournament.Phases[0]!.Rounds.entries()) {
		const paired = synced.includes(round.Name);
		const [stored] = await db.insert(schema.rounds).values({
			eventId,
			phaseId: phase!.id,
			name: round.Name,
			roundNumber: index + 1,
			externalId: String(round.ID),
			externalSource: 'melee',
			lastSyncedAt: paired
				? EARLIER
				: null,
		}).returning();
		if (paired) {
			await db.insert(schema.playerRoundStandings).values(players.map(player => ({
				eventId,
				playerId: player.id,
				roundId: stored!.id,
				wins: 1,
			})));
		}
	}
	return eventId;
}

async function readEvent(eventId: number) {
	const [event] = await db.select().from(schema.events).where(eq(schema.events.id, eventId));
	return event!;
}

/** What the Event holds, by name: its Phases, Rounds and Players, the Rounds holding Matches, and its Deck Lists. */
async function storedIn(eventId: number) {
	const names = (rows: { name: string | null }[]) => rows.map(row => row.name);
	const paired = await db.selectDistinct({ name: schema.rounds.name })
		.from(schema.matches)
		.innerJoin(schema.rounds, eq(schema.rounds.id, schema.matches.roundId))
		.where(eq(schema.matches.eventId, eventId))
		.orderBy(schema.rounds.roundNumber);
	return {
		phases: names(await db.select().from(schema.phases).where(eq(schema.phases.eventId, eventId)).orderBy(schema.phases.id)),
		rounds: names(await db.select().from(schema.rounds).where(eq(schema.rounds.eventId, eventId)).orderBy(schema.rounds.id)),
		players: names(await db.select().from(schema.players).where(eq(schema.players.eventId, eventId)).orderBy(schema.players.id)),
		pairedRounds: names(paired),
		deckLists: names(await db.select().from(schema.playerDecks).where(eq(schema.playerDecks.eventId, eventId)).orderBy(schema.playerDecks.id)),
	};
}

/** Each `melee:` message published so far, by type. */
function announcedByMelee() {
	return publishMessage.mock.calls.map(([, type]) => type as string).filter(type => type.startsWith('melee:'));
}

beforeEach(() => {
	failNextCorrection = undefined;
	publishMessage.mockReset();
	melee.fetchEvent.mockReset().mockResolvedValue(tournament);
	melee.fetchPlayers.mockReset().mockResolvedValue(tournamentPlayers);
	melee.fetchCurrentStandings.mockReset().mockResolvedValue([]);
	melee.fetchMergedPlayers.mockReset().mockResolvedValue(mapMeleePlayersToDb(tournamentPlayers, []));
	melee.fetchMatchesByRound.mockReset().mockImplementation(async (meleeRoundId: number) => pairings(meleeRoundId));
	melee.fetchStandingsByRound.mockReset().mockResolvedValue([]);
});

describe('initial Setup', () => {
	it('imports structure, Players and Deck Lists from one upstream snapshot, and no Round\'s Matches', async () => {
		const eventId = await createEvent();

		const result = await meleeSyncModule().runInitialSetup(requestEvent, eventId);

		expect(result).toMatchObject({
			success: true,
			steps: ['structure', 'players', 'decklists'],
			phases: 1,
			rounds: 2,
		});
		expect(await storedIn(eventId)).toEqual({
			phases: ['Swiss'],
			rounds: ['Round 1', 'Round 2'],
			players: [
				'Player 1',
				'Player 2',
				'Player 3',
				'Player 4',
			],
			pairedRounds: [],
			deckLists: ['Burn'],
		});
		// One snapshot: each stage reads what the first fetch answered.
		expect(melee.fetchEvent).toHaveBeenCalledOnce();
		expect(melee.fetchPlayers).toHaveBeenCalledOnce();
		expect(melee.fetchCurrentStandings).toHaveBeenCalledOnce();
		expect(melee.fetchMergedPlayers).not.toHaveBeenCalled();
		expect(melee.fetchMatchesByRound).not.toHaveBeenCalled();
	});

	it('refuses a tournament of another game before storing any of it', async () => {
		const eventId = await createEvent();
		melee.fetchEvent.mockResolvedValue({ ...tournament, Game: 'One Piece Card Game' });

		await expect(meleeSyncModule().runInitialSetup(requestEvent, eventId)).rejects.toMatchObject({
			statusCode: 422,
			data: { code: 'MELEE_GAME_MISMATCH' },
		});

		expect(await storedIn(eventId)).toMatchObject({ phases: [], players: [], deckLists: [] });
		expect(announcedByMelee()).toEqual([]);
		expect((await readEvent(eventId)).initialSetupCompletedAt).toBeNull();
	});

	// A game Melee names that no adapter reads still has structure and Players
	// worth importing: setup completes without Deck Lists, and says so.
	it('completes without Deck Lists, and records no Deck List sync, for a tournament of an unrecognised game', async () => {
		const eventId = await createEvent();
		melee.fetchEvent.mockResolvedValue({ ...tournament, Game: 'Some Future Game' });

		const result = await meleeSyncModule().runInitialSetup(requestEvent, eventId);

		expect(result).toMatchObject({
			success: true,
			deckListsSkipped: true,
			deckLists: { players: 0, deckLists: 0 },
		});
		expect(result.warnings).toContain('Melee.gg reported an unrecognized game, so MTG Deck Lists were not imported');
		expect(await storedIn(eventId)).toMatchObject({
			phases: ['Swiss'],
			players: [
				'Player 1',
				'Player 2',
				'Player 3',
				'Player 4',
			],
			deckLists: [],
		});
		const event = await readEvent(eventId);
		expect(event.initialSetupCompletedAt).toBeInstanceOf(Date);
		expect(event.lastDecklistsSyncedAt).toBeNull();
	});
});

describe('update from Melee', () => {
	it.each([
		{
			case: 'refreshes the Round before the next unpaired one, then advances it, leaving synced Deck Lists alone',
			synced: ['Round 1'],
			deckListsSynced: true,
			options: {},
			steps: [
				'structure',
				'players',
				'previous-round',
				'next-round',
			],
			refreshed: 'Round 1',
			advanced: 'Round 2',
			pairedRounds: ['Round 1', 'Round 2'],
			deckLists: [],
		},
		{
			case: 'imports Deck Lists again when asked to',
			synced: [],
			deckListsSynced: true,
			options: { includeDeckLists: true },
			steps: [
				'structure',
				'players',
				'decklists',
				'next-round',
			],
			refreshed: null,
			advanced: 'Round 1',
			pairedRounds: ['Round 1'],
			deckLists: ['Burn'],
		},
		{
			case: 'imports Deck Lists unasked when none were ever synced',
			synced: [],
			deckListsSynced: false,
			options: {},
			steps: [
				'structure',
				'players',
				'decklists',
				'next-round',
			],
			refreshed: null,
			advanced: 'Round 1',
			pairedRounds: ['Round 1'],
			deckLists: ['Burn'],
		},
		{
			case: 'refreshes only the latest synced Round when none is left to advance',
			synced: ['Round 1', 'Round 2'],
			deckListsSynced: true,
			options: {},
			steps: ['structure', 'players', 'latest-round'],
			refreshed: 'Round 2',
			advanced: null,
			pairedRounds: ['Round 2'],
			deckLists: [],
		},
	])('$case', async ({ synced, deckListsSynced, options, steps, refreshed, advanced, pairedRounds, deckLists }) => {
		const eventId = await seedTournament({ synced, deckListsSynced });

		const result = await meleeSyncModule().updateFromMelee(requestEvent, eventId, options);

		expect(result.steps).toEqual(steps);
		expect(result.refreshedRound?.name ?? null).toBe(refreshed);
		expect(result.advancedRound?.name ?? null).toBe(advanced);
		expect(await storedIn(eventId)).toMatchObject({ pairedRounds, deckLists });
	});

	// Each stage is durable on its own, so a command that has lost the Event
	// stops at the next checkpoint rather than write over its new owner.
	it('stops before its next stage once another command holds the Event, leaving that command\'s lease alone', async () => {
		const eventId = await createEvent();
		publishMessage.mockImplementation(async (_eventId: number, type: string) => {
			if (type === 'melee:structureSynced')
				await db.update(schema.events).set({ meleeSyncLeaseToken: 'another-command' }).where(eq(schema.events.id, eventId));
		});

		await expect(meleeSyncModule().updateFromMelee(requestEvent, eventId)).rejects.toThrow('lease ownership was lost');

		expect(await storedIn(eventId)).toEqual({
			phases: ['Swiss'],
			rounds: ['Round 1', 'Round 2'],
			players: [],
			pairedRounds: [],
			deckLists: [],
		});
		expect(await readEvent(eventId)).toMatchObject({ meleeSyncLeaseToken: 'another-command', lastSyncError: null });
	});
});

describe('syncing Event structure', () => {
	it.each([
		{
			kind: 'Phase',
			phases: [
				{
					ID: 10,
					Name: 'Swiss A',
					FormatId: 'modern',
					SortOrder: 0,
					Rounds: [],
				},
				{
					ID: 10,
					Name: 'Swiss B',
					FormatId: 'modern',
					SortOrder: 1,
					Rounds: [],
				},
			],
			refusal: 'Duplicate Melee phase external identity: 10',
		},
		{
			kind: 'Round',
			phases: [
				{
					ID: 10,
					Name: 'Swiss',
					FormatId: 'modern',
					SortOrder: 0,
					Rounds: [
						{ ID: 101, Name: 'Round 1', SortOrder: 0 },
					],
				},
				{
					ID: 11,
					Name: 'Top Cut',
					FormatId: 'modern',
					SortOrder: 1,
					Rounds: [
						{ ID: 101, Name: 'Quarterfinals', SortOrder: 0 },
					],
				},
			],
			refusal: 'Duplicate Melee round external identity: 101',
		},
	])('refuses a tournament naming one $kind identity twice, storing none of its structure', async ({ phases, refusal }) => {
		const eventId = await createEvent();
		melee.fetchEvent.mockResolvedValue({ ...tournament, Phases: phases });

		await expect(meleeSyncModule().syncEventStructure(requestEvent, eventId)).rejects.toThrow(refusal);

		expect(await storedIn(eventId)).toMatchObject({ phases: [], rounds: [] });
		expect(announcedByMelee()).toEqual([]);
	});

	it('names the provider\'s refusal in the log when its notification cannot be delivered', async () => {
		const eventId = await createEvent();
		publishMessage.mockImplementation(async (_eventId: number, type: string) => {
			if (type === 'melee:structureSynced')
				throw providerRefusal();
		});
		const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const result = await meleeSyncModule().syncEventStructure(requestEvent, eventId);

		const [line] = lastCallTo(warned, ([logged]) => typeof logged === 'string' && logged.includes('"message":"melee_sync_realtime_publish_failed"'));
		expect(JSON.parse(line as string)).toEqual({
			message: 'melee_sync_realtime_publish_failed',
			messageType: 'melee:structureSynced',
			statusCode: 404,
			errorCode: 40400,
			errorName: 'Error',
			reason: 'No application found',
		});
		expect(result).toMatchObject({
			success: true,
			warnings: ['Data was saved, but realtime notification "melee:structureSynced" could not be delivered'],
		});
		expect(await storedIn(eventId)).toMatchObject({
			phases: ['Swiss'],
			rounds: ['Round 1', 'Round 2'],
		});
	});
});

describe('syncing a Round\'s Matches', () => {
	it.each([
		{ case: 'another Event\'s Round', round: 'foreign', statusCode: 404 },
		{ case: 'a manual Round', round: 'manual', statusCode: 400 },
	] as const)('refuses $case with a $statusCode, without asking Melee for its Matches', async ({ round, statusCode }) => {
		const eventId = await createEvent();
		const insertRound = async (ownerId: number, externalId: string | null) => {
			const [phase] = await db.insert(schema.phases).values({ eventId: ownerId, name: 'Swiss' }).returning();
			const [stored] = await db.insert(schema.rounds).values({
				eventId: ownerId,
				phaseId: phase!.id,
				name: 'Round 1',
				roundNumber: 1,
				externalId,
				externalSource: externalId ? 'melee' : 'manual',
			}).returning();
			return stored!.id;
		};
		const rounds = {
			foreign: await insertRound(await createEvent(), '101'),
			manual: await insertRound(eventId, null),
		};
		const [manualMatch] = await db.insert(schema.matches).values({ eventId, roundId: rounds.manual, tableNumber: 1 }).returning();

		await expect(meleeSyncModule().syncRoundMatches(requestEvent, eventId, rounds[round])).rejects.toMatchObject({ statusCode });

		expect(melee.fetchMatchesByRound).not.toHaveBeenCalled();
		expect(await db.select().from(schema.matches).where(eq(schema.matches.roundId, rounds.manual)))
			.toEqual([manualMatch]);
		expect(await db.select().from(schema.matches).where(eq(schema.matches.roundId, rounds.foreign)))
			.toEqual([]);
	});
});

// A sync's own write has committed by the time its Reverse Sync runs, so a
// Session an operator advanced meanwhile must not fail it: the Slot keeps its
// previous snapshot and the next pass finds the same change.
describe('a sync whose Reverse Sync loses a Session race', () => {
	it.each([
		{
			sync: 'a Player sync',
			run: (eventId: number) => meleeSyncModule().syncPlayers(requestEvent, eventId),
		},
		{
			sync: 'a Deck List sync',
			run: (eventId: number) => meleeSyncModule().syncDeckLists(requestEvent, eventId),
		},
	])('$sync still succeeds, leaving the Slot for the next pass', async ({ run }) => {
		const eventId = await seedTournament({ synced: [], deckListsSynced: true });
		const [seated] = await db.select().from(schema.players).where(eq(schema.players.eventId, eventId)).orderBy(schema.players.id);
		const [slot] = await db.insert(schema.featureMatches).values({
			eventId,
			tableNumber: 1,
			player1Id: seated!.id,
			player1Data: { name: 'Old Name' },
		}).returning();
		failNextCorrection = Object.assign(new Error('Feature match session has advanced'), { statusCode: 409 });
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

		const result = await run(eventId);

		expect(result).toMatchObject({
			success: true,
			results: { matchesUpdated: 0 },
		});
		expect(logged).toHaveBeenCalledWith(expect.stringContaining('feature_match_reverse_sync_conflict'));
		expect((await db.query.featureMatches.findFirst({
			where: eq(schema.featureMatches.id, slot!.id),
		}))?.player1Data).toEqual({ name: 'Old Name' });
		expect((await readEvent(eventId)).lastSyncError).toBeNull();
	});
});
