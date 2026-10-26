import type { H3Event } from 'h3';
import type { MappedMeleePlayer } from '~~/server/mappers/melee';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/*
 * Melee Sync commands against real SQL: only the upstream boundaries are stood in
 * for — Melee itself, the card provider, Ably — and Round Match import, which
 * roundMatches.sqlite owns. Lease and sync metadata are the real Event columns.
 */

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

const melee = {
	fetchEvent: vi.fn(),
	fetchMergedPlayers: vi.fn(),
	fetchPlayers: vi.fn(),
};
const resolveBatch = vi.fn();
const publishMessage = vi.fn();
const syncMatchesFromMelee = vi.fn();

vi.doMock('~~/server/db', () => ({ db }));
vi.doMock('~~/server/services/meleeIntegration', () => ({
	requireMeleeService: () => melee,
}));
vi.doMock('~~/server/services/importedMtgCardResolver', () => ({
	importedMtgCardResolverService: () => ({ resolveBatch }),
}));
vi.doMock('~~/server/utils/ably', () => ({
	getOriginConnectionId: () => 'origin-1',
	publishMessage,
	publishMessageStrict: publishMessage,
}));
vi.doMock('~~/server/modules/broadcast-graphics-live-session', () => ({
	refreshBroadcastGraphicsBindings: vi.fn(),
}));
vi.doMock('~~/server/modules/melee-sync/roundMatches', () => ({ syncMatchesFromMelee }));
vi.stubGlobal('createError', (input: { statusCode: number; message?: string; statusMessage?: string; data?: unknown }) =>
	Object.assign(new Error(input.message ?? input.statusMessage), input));

const { meleeSyncModule } = await import('~~/server/modules/melee-sync');

afterAll(async () => await harness.close());

const requestEvent = {} as H3Event;
const mtgEvent = { Name: 'Melee Championship', Game: 'Magic: The Gathering', Phases: [] };

async function createEvent(game: 'mtg' | 'op' = 'mtg') {
	const [event] = await db.insert(schema.events).values({
		name: 'Melee Championship',
		game,
		featureMatchOrientation: 'horizontal',
		meleeEnabled: true,
		meleeEventId: 'melee-1',
	}).returning({ id: schema.events.id });
	return event!.id;
}

async function readEvent(eventId: number) {
	const [event] = await db.select().from(schema.events).where(eq(schema.events.id, eventId));
	return event!;
}

function published(type: string) {
	return publishMessage.mock.calls.filter(([, messageType]) => messageType === type).map(([, , payload]) => payload);
}

function meleePlayer(externalId: string, name: string): MappedMeleePlayer {
	return {
		externalId,
		externalSource: 'melee',
		externalStatus: null,
		name,
		pronouns: null,
		wins: 3,
		losses: 1,
		draws: 0,
		position: 2,
		points: 9,
		deckLists: undefined,
	};
}

async function playersOf(eventId: number) {
	return await db.select().from(schema.players).where(eq(schema.players.eventId, eventId)).orderBy(schema.players.externalId);
}

beforeEach(() => {
	vi.clearAllMocks();
	melee.fetchEvent.mockResolvedValue(mtgEvent);
	melee.fetchMergedPlayers.mockResolvedValue([]);
	melee.fetchPlayers.mockResolvedValue([]);
	resolveBatch.mockResolvedValue({
		resolutions: new Map(),
	});
	publishMessage.mockResolvedValue(undefined);
});

describe('syncing Players', () => {
	it('reconciles the Event\'s Players to Melee\'s snapshot, deactivating those it no longer lists', async () => {
		const eventId = await createEvent();
		await db.insert(schema.players).values({
			eventId,
			name: 'Gone',
			externalId: 'player-2',
			externalSource: 'melee',
		});
		melee.fetchMergedPlayers.mockResolvedValue([
			meleePlayer('player-1', 'Alice'),
		]);

		const result = await meleeSyncModule().syncPlayers(requestEvent, eventId);

		expect(result.results).toEqual({
			created: 1,
			updated: 0,
			deactivated: 1,
			matchesUpdated: 0,
			errors: [],
		});
		expect(result.message).toContain('deactivated 1 missing player');
		expect((await playersOf(eventId)).map(player => [player.name, player.isActive, player.points])).toEqual([
			['Alice', true, 9],
			['Gone', false, null],
		]);
		expect(published('melee:playersSynced')).toEqual([
			{ playerCount: 1 },
		]);

		const event = await readEvent(eventId);
		expect(event.lastPlayersSyncedAt).toBeInstanceOf(Date);
		expect(event.lastSyncError).toBeNull();
		expect(event.meleeSyncLeaseToken).toBeNull();
	});

	it('announces no Players change when the sync changed no Player', async () => {
		const eventId = await createEvent();
		melee.fetchMergedPlayers.mockResolvedValue([
			meleePlayer('player-1', 'Alice'),
		]);
		await meleeSyncModule().syncPlayers(requestEvent, eventId);
		publishMessage.mockClear();

		const result = await meleeSyncModule().syncPlayers(requestEvent, eventId);

		expect(result.success).toBe(true);
		expect(published('melee:playersSynced')).toEqual([]);
	});

	it('announces the Feature Match Slots whose Players it changed, in one message', async () => {
		const eventId = await createEvent();
		const [player] = await db.insert(schema.players).values({
			eventId,
			name: 'Alice',
			externalId: 'player-1',
			externalSource: 'melee',
		}).returning();
		const [slot] = await db.insert(schema.featureMatches).values({ eventId, tableNumber: 1, player1Id: player!.id }).returning();
		melee.fetchMergedPlayers.mockResolvedValue([
			meleePlayer('player-1', 'Alice Renamed'),
		]);

		const result = await meleeSyncModule().syncPlayers(requestEvent, eventId);

		expect(result.results.matchesUpdated).toBe(1);
		expect(published('melee:featureMatchesSynced')).toEqual([
			{
				slotIds: [slot!.id],
			},
		]);
	});

	it('keeps a committed sync successful, with a warning, when its notification cannot be delivered', async () => {
		const eventId = await createEvent();
		melee.fetchMergedPlayers.mockResolvedValue([
			meleePlayer('player-1', 'Alice'),
		]);
		publishMessage.mockImplementation(async (_eventId: number, type: string) => {
			if (type === 'melee:playersSynced')
				throw new Error('Ably unavailable');
		});
		vi.spyOn(console, 'warn').mockImplementation(() => {});

		const result = await meleeSyncModule().syncPlayers(requestEvent, eventId);

		expect(result).toMatchObject({
			success: true,
			warnings: [
				expect.stringContaining('Data was saved, but realtime notification "melee:playersSynced" could not be delivered'),
			],
		});
		expect(await playersOf(eventId)).toHaveLength(1);
		expect((await readEvent(eventId)).lastSyncError).toBeNull();
	});

	it('refuses an Event that does not exist', async () => {
		await expect(meleeSyncModule().syncPlayers(requestEvent, 999_999)).rejects.toMatchObject({ statusCode: 404 });
	});
});

describe('syncing Event structure', () => {
	const upstream = {
		...mtgEvent,
		Phases: [
			{
				ID: 100,
				Name: 'Swiss',
				FormatId: 'modern',
				SortOrder: 0,
				Rounds: [
					{ ID: 1001, Name: 'Round 1', SortOrder: 0 },
					{ ID: 1002, Name: 'Round 2', SortOrder: 1 },
				],
			},
			{
				ID: 200,
				Name: 'Top Cut',
				FormatId: 'modern',
				SortOrder: 1,
				Rounds: [],
			},
		],
	};

	it('imports Melee\'s Phases and Rounds, drops stale imported ones, and announces one change set', async () => {
		const eventId = await createEvent();
		const [stale] = await db.insert(schema.phases).values({
			eventId,
			name: 'Old Phase',
			externalId: 'stale',
			externalSource: 'melee',
			formatExternalId: 'modern',
		}).returning();
		melee.fetchEvent.mockResolvedValue(upstream);

		const result = await meleeSyncModule().syncEventStructure(requestEvent, eventId);

		expect(result).toMatchObject({ success: true, phases: 2, rounds: 2 });
		const phases = await db.select().from(schema.phases).where(eq(schema.phases.eventId, eventId)).orderBy(schema.phases.sortOrder);
		expect(phases.map(phase => [phase.name, phase.externalId])).toEqual([
			['Swiss', '100'],
			['Top Cut', '200'],
		]);
		const rounds = await db.select().from(schema.rounds).where(eq(schema.rounds.eventId, eventId)).orderBy(schema.rounds.roundNumber);
		expect(rounds.map(round => [round.name, round.roundNumber, round.phaseId])).toEqual([
			['Round 1', 1, phases[0]!.id],
			['Round 2', 2, phases[0]!.id],
		]);

		expect(published('melee:structureSynced')).toEqual([
			{
				phaseCount: 2,
				roundCount: 2,
				changes: {
					phases: {
						created: phases.map(phase => phase.id),
						updated: [],
						deleted: [stale!.id],
					},
					rounds: {
						created: rounds.map(round => round.id),
						updated: [],
						deleted: [],
					},
				},
			},
		]);
		expect((await readEvent(eventId)).lastEventSyncedAt).toBeInstanceOf(Date);
	});

	it('writes and announces nothing when Melee\'s structure has not changed', async () => {
		const eventId = await createEvent();
		melee.fetchEvent.mockResolvedValue(upstream);
		await meleeSyncModule().syncEventStructure(requestEvent, eventId);
		publishMessage.mockClear();

		await expect(meleeSyncModule().syncEventStructure(requestEvent, eventId)).resolves.toMatchObject({ success: true, phases: 2, rounds: 2 });

		expect(published('melee:structureSynced')).toEqual([]);
	});
});

describe('syncing Deck Lists', () => {
	const burn = {
		TeamId: 1,
		PlayerName: 'Alice',
		PronounsDescription: null,
		Decklists: [
			{
				Guid: 'deck-burn',
				FormatId: 'modern',
				DecklistName: 'Burn',
				Records: [
					{
						l: 'lightning-bolt',
						n: 'Lightning Bolt',
						s: '2X2',
						q: 4,
						c: 0,
						t: 'Instant',
					},
					{
						l: 'mystery-card',
						n: 'Mystery Card',
						s: null,
						q: 1,
						c: 0,
						t: 'Creature',
					},
				],
				Attributes: [
					{ k: 'COLOR_RED', v: 'True', p: null },
				],
			},
		],
	};
	const resolvedBolt = new Map([
		[
			'lightning bolt|2x2',
			{
				status: 'resolved',
				source: 'exact',
				inputName: 'Lightning Bolt',
				inputSetCode: '2X2',
				resolvedName: 'Lightning Bolt',
				cardData: {
					name: 'Lightning Bolt',
					setCode: '2x2',
					id: 'scryfall-bolt',
					oracleId: 'oracle-bolt',
					manaCost: '{R}',
					cmc: 1,
					colors: 'R',
					typeLine: 'Instant',
				},
				overrideCard: null,
			},
		],
		[
			'mystery card',
			{ status: 'unresolved', inputName: 'Mystery Card', inputSetCode: null },
		],
	]);

	async function decksOf(eventId: number) {
		return await db.select().from(schema.playerDecks).where(eq(schema.playerDecks.eventId, eventId));
	}

	it('stores resolved cards and keeps the unresolved ones for the Sync page, without blocking the Deck List', async () => {
		const eventId = await createEvent();
		melee.fetchPlayers.mockResolvedValue([burn]);
		resolveBatch.mockResolvedValue({ resolutions: resolvedBolt });

		const result = await meleeSyncModule().syncDeckLists(requestEvent, eventId);

		expect(result).toMatchObject({
			success: true,
			results: { players: 1, deckLists: 1, unresolvedCards: 1 },
			warnings: ['1 deck entry remains unresolved and can be fixed from the Sync page'],
		});
		const [deck] = await decksOf(eventId);
		expect(deck).toMatchObject({
			externalId: 'deck-burn',
			name: 'Burn',
			colors: 'R',
			isPrimary: true,
		});
		const cards = await db.select({ name: schema.cards.name, quantity: schema.playerDeckCards.quantity })
			.from(schema.playerDeckCards)
			.innerJoin(schema.cards, eq(schema.cards.id, schema.playerDeckCards.cardId))
			.where(eq(schema.playerDeckCards.deckId, deck!.id));
		expect(cards).toEqual([
			{ name: 'Lightning Bolt', quantity: 4 },
		]);
		const unresolved = await db.select().from(schema.playerDeckUnresolvedCards).where(eq(schema.playerDeckUnresolvedCards.deckId, deck!.id));
		expect(unresolved).toEqual([
			expect.objectContaining({ originalName: 'Mystery Card', entryType: 'card' }),
		]);
		expect(published('melee:decklistsSynced')).toEqual([
			{ playerCount: 1, deckCount: 1 },
		]);
		expect((await readEvent(eventId)).lastDecklistsSyncedAt).toBeInstanceOf(Date);
	});

	it('removes a Player\'s imported Deck List once Melee no longer lists it', async () => {
		const eventId = await createEvent();
		melee.fetchPlayers.mockResolvedValue([burn]);
		resolveBatch.mockResolvedValue({ resolutions: resolvedBolt });
		await meleeSyncModule().syncDeckLists(requestEvent, eventId);

		melee.fetchPlayers.mockResolvedValue([
			{ ...burn, Decklists: [] },
		]);
		await expect(meleeSyncModule().syncDeckLists(requestEvent, eventId)).resolves.toMatchObject({
			results: { players: 1, deckLists: 0 },
		});

		expect(await decksOf(eventId)).toEqual([]);
	});

	it('keeps the previous Deck Lists and their sync time when the card provider is unavailable', async () => {
		const eventId = await createEvent();
		melee.fetchPlayers.mockResolvedValue([burn]);
		resolveBatch.mockResolvedValue({ resolutions: resolvedBolt });
		await meleeSyncModule().syncDeckLists(requestEvent, eventId);
		const syncedAt = (await readEvent(eventId)).lastDecklistsSyncedAt;
		const unavailable = Object.assign(new Error('Card data lookup is temporarily unavailable; existing deck data was preserved'), { code: 'IMPORTED_CARD_LOOKUP_UNAVAILABLE' });
		resolveBatch.mockRejectedValue(unavailable);
		melee.fetchPlayers.mockResolvedValue([
			{ ...burn, Decklists: [] },
		]);

		await expect(meleeSyncModule().syncDeckLists(requestEvent, eventId)).rejects.toBe(unavailable);

		expect(await decksOf(eventId)).toHaveLength(1);
		const event = await readEvent(eventId);
		expect(event.lastDecklistsSyncedAt).toEqual(syncedAt);
		expect(event.lastSyncError).toContain('temporarily unavailable');
	});

	it('refuses a non-MTG Event before reading Melee, and records the refusal', async () => {
		const eventId = await createEvent('op');
		melee.fetchEvent.mockResolvedValue({ Name: 'OP Event', Game: 'One Piece Card Game', Phases: [] });

		await expect(meleeSyncModule().syncDeckLists(requestEvent, eventId)).rejects.toMatchObject({
			statusCode: 422,
			data: { code: 'MELEE_DECKLIST_GAME_UNSUPPORTED' },
		});

		expect(melee.fetchPlayers).not.toHaveBeenCalled();
		expect(await decksOf(eventId)).toEqual([]);
		const event = await readEvent(eventId);
		expect(event.lastDecklistsSyncedAt).toBeNull();
		expect(event.lastSyncError).not.toBeNull();
	});
});

describe('syncing a Round\'s Matches', () => {
	it('keeps the Match import\'s own warnings beside a notification it could not deliver', async () => {
		const eventId = await createEvent();
		const [phase] = await db.insert(schema.phases).values({
			eventId,
			name: 'Swiss',
			externalId: '100',
			externalSource: 'melee',
			formatExternalId: 'modern',
		}).returning();
		const [round] = await db.insert(schema.rounds).values({
			eventId,
			phaseId: phase!.id,
			name: 'Round 1',
			roundNumber: 1,
			externalId: '1001',
			externalSource: 'melee',
		}).returning();
		syncMatchesFromMelee.mockResolvedValue({
			success: true,
			message: 'Synced Round 1',
			round: {
				id: round!.id,
				name: 'Round 1',
				roundNumber: 1,
				phaseId: phase!.id,
			},
			matchCount: 2,
			created: 1,
			updated: 1,
			staleDeleted: 0,
			warnings: ['A player deck could not be selected'],
		});
		publishMessage.mockImplementation(async (_eventId: number, type: string) => {
			if (type === 'melee:roundSynced')
				throw new Error('Ably unavailable');
		});
		vi.spyOn(console, 'warn').mockImplementation(() => {});

		const result = await meleeSyncModule().syncRoundMatches(requestEvent, eventId, round!.id);

		expect(result).toMatchObject({
			success: true,
			warnings: [
				'A player deck could not be selected',
				expect.stringContaining('realtime notification "melee:roundSynced" could not be delivered'),
			],
		});
		expect((await readEvent(eventId)).lastSyncError).toBeNull();
	});
});

it('leaves another Event\'s Players untouched', async () => {
	const eventId = await createEvent();
	const otherEventId = await createEvent();
	await db.insert(schema.players).values({
		eventId: otherEventId,
		name: 'Elsewhere',
		externalId: 'player-9',
		externalSource: 'melee',
	});
	melee.fetchMergedPlayers.mockResolvedValue([
		meleePlayer('player-1', 'Alice'),
	]);

	await meleeSyncModule().syncPlayers(requestEvent, eventId);

	const [other] = await db.select().from(schema.players).where(and(eq(schema.players.eventId, otherEventId), eq(schema.players.externalId, 'player-9')));
	expect(other?.isActive).toBe(true);
});
