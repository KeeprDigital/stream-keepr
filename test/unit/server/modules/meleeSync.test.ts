import type { H3Event } from 'h3';
import type { DbCard, DbFeatureMatch, DbPhase, DbRound } from '~~/server/db/schema';
import type { MappedMeleePlayer } from '~~/server/mappers/melee';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEventService = {
	findById: vi.fn(),
	tryAcquireLiveRefreshLease: vi.fn(),
};
const mockPhaseService = {
	findByEventId: vi.fn(),
	remove: vi.fn(),
	upsertByExternalId: vi.fn(),
	findById: vi.fn(),
};
const mockRoundService = {
	upsertByExternalId: vi.fn(),
	remove: vi.fn(),
	findById: vi.fn(),
	findActiveRound: vi.fn(),
	findByEventId: vi.fn(),
	findByPhaseId: vi.fn(),
};
const mockPlayerService = {
	batchUpsertByExternalId: vi.fn(),
	reconcileMeleeSnapshot: vi.fn(),
};
const mockPlayerFeatureMatchSyncService = {
	syncMatchesFromPlayers: vi.fn(),
};
const mockFeatureMatchService = {
	findById: vi.fn(),
};
const mockImportedMtgCardResolverService = {
	resolveBatch: vi.fn(),
};
const mockMtgCardService = {
	batchUpsert: vi.fn(),
};
const mockValidateImportedCompanionSnapshot = vi.fn();
const mockPlayerDeckService = {
	replaceMeleeDecksForEvent: vi.fn(),
};
const mockPublishMessage = vi.fn();
const mockGetOriginConnectionId = vi.fn();
const mockRecordMeleeSyncSuccess = vi.fn();
const mockRecordMeleeSyncFailure = vi.fn();
const mockAcquireMeleeSyncLease = vi.fn();
const mockReleaseMeleeSyncLease = vi.fn();
const mockRenewMeleeSyncLease = vi.fn();
const mockRequireMeleeService = vi.fn();
const mockSyncMatchesFromMelee = vi.fn();

class MockDeckCompanionValidationError extends Error {}

const mockRefreshBindings = vi.fn();

vi.mock('~~/server/modules/broadcast-graphics-live-session', () => ({
	refreshBroadcastGraphicsBindings: mockRefreshBindings,
}));

vi.mock('~~/server/services/event', () => ({
	eventService: () => mockEventService,
}));
vi.mock('~~/server/services/phase', () => ({
	phaseService: () => mockPhaseService,
}));
vi.mock('~~/server/services/round', () => ({
	roundService: () => mockRoundService,
}));
vi.mock('~~/server/services/player', () => ({
	playerService: () => mockPlayerService,
}));
vi.mock('~~/server/services/playerFeatureMatchSync', () => ({
	playerFeatureMatchSyncService: () => mockPlayerFeatureMatchSyncService,
}));
vi.mock('~~/server/services/featureMatch', () => ({
	featureMatchService: () => mockFeatureMatchService,
}));
vi.mock('~~/server/services/importedMtgCardResolver', () => ({
	importedMtgCardResolverService: () => mockImportedMtgCardResolverService,
}));
vi.mock('~~/server/services/mtgCard', () => ({
	mtgCardService: () => mockMtgCardService,
}));
vi.mock('~~/server/services/playerDeckCompanion', () => ({
	DeckCompanionValidationError: MockDeckCompanionValidationError,
	validateImportedCompanionSnapshot: mockValidateImportedCompanionSnapshot,
}));
vi.mock('~~/server/services/playerDeck', () => ({
	playerDeckService: () => mockPlayerDeckService,
}));
vi.mock('~~/server/utils/ably', () => ({
	getOriginConnectionId: mockGetOriginConnectionId,
	publishMessage: mockPublishMessage,
	publishMessageStrict: mockPublishMessage,
}));
vi.mock('~~/server/utils/meleeSyncState', () => ({
	acquireMeleeSyncLease: mockAcquireMeleeSyncLease,
	MELEE_SYNC_LEASE_RENEW_INTERVAL_MS: 60_000,
	recordMeleeSyncFailure: mockRecordMeleeSyncFailure,
	recordMeleeSyncSuccess: mockRecordMeleeSyncSuccess,
	releaseMeleeSyncLease: mockReleaseMeleeSyncLease,
	renewMeleeSyncLease: mockRenewMeleeSyncLease,
}));
vi.mock('~~/server/services/meleeIntegration', () => ({
	requireMeleeService: mockRequireMeleeService,
}));
vi.mock('~~/server/modules/melee-sync/roundMatches', () => ({
	syncMatchesFromMelee: mockSyncMatchesFromMelee,
}));

vi.stubGlobal('createError', (input: { statusCode: number; message?: string; statusMessage?: string; data?: unknown }) => {
	const error = new Error(input.message ?? input.statusMessage) as Error & { statusCode: number; data?: unknown };
	error.statusCode = input.statusCode;
	error.data = input.data;
	return error;
});

const { meleeSyncModule } = await import('~~/server/modules/melee-sync');

const NOW = new Date('2026-01-01T00:00:00Z');
const requestEvent = {} as H3Event;
const eventData = {
	game: 'mtg' as const,
	meleeEnabled: true,
	meleeEventId: 'melee-event-1',
	meleeClientId: 'client-id',
	meleeClientSecret: 'client-secret',
};

function createPhase(overrides: Partial<DbPhase> = {}): DbPhase {
	return {
		id: 2,
		eventId: 1,
		name: 'Swiss',
		sortOrder: 0,
		externalId: '100',
		externalSource: 'melee',
		formatExternalId: 'modern',
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	};
}

function createRound(overrides: Partial<DbRound> = {}): DbRound {
	return {
		id: 10,
		eventId: 1,
		phaseId: 2,
		externalId: '1001',
		externalSource: 'melee',
		name: 'Round 1',
		roundNumber: 1,
		controlMode: 'default',
		lastSyncedAt: null,
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	};
}

function createFeatureMatch(overrides: Partial<DbFeatureMatch> = {}): DbFeatureMatch {
	return {
		id: 20,
		eventId: 1,
		matchId: null,
		externalId: null,
		externalSource: null,
		tableNumber: 4,
		player1Id: null,
		player2Id: null,
		player1Data: null,
		player2Data: null,
		bestOf: 3,
		sortOrder: 0,
		playerDisplayMode: 'score',
		activeSessionId: null,
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	};
}

function createCard(overrides: Partial<DbCard> = {}): DbCard {
	return {
		id: 501,
		name: 'Lightning Bolt',
		game: 'mtg',
		scryfallId: 'scryfall-bolt',
		oracleId: 'oracle-bolt',
		cardType: 'Instant',
		colors: 'R',
		cmc: 1,
		manaCost: '{R}',
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	};
}

function createMeleePlayer(overrides: Partial<MappedMeleePlayer> = {}): MappedMeleePlayer {
	return {
		externalId: 'player-1',
		externalSource: 'melee',
		externalStatus: null,
		name: 'Alice',
		pronouns: null,
		wins: 3,
		losses: 1,
		draws: 0,
		position: 2,
		points: 9,
		deckLists: undefined,
		...overrides,
	};
}

describe('melee Sync server module', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockPhaseService.findByEventId.mockResolvedValue([]);
		mockPhaseService.remove.mockResolvedValue(true);
		mockPhaseService.upsertByExternalId.mockImplementation(async input => ({
			phase: createPhase({ id: input.externalId === '100' ? 2 : 3, name: input.name, sortOrder: input.sortOrder, externalId: input.externalId }),
			created: input.externalId === '100',
		}));
		mockPhaseService.findById.mockResolvedValue(createPhase());
		mockRoundService.upsertByExternalId.mockImplementation(async input => ({
			round: createRound({ id: Number(input.externalId) - 991, phaseId: input.phaseId, name: input.name, roundNumber: input.roundNumber, externalId: input.externalId }),
			created: input.externalId !== '1002',
		}));
		mockRoundService.findById.mockResolvedValue(createRound());
		mockRoundService.findActiveRound.mockResolvedValue(null);
		mockRoundService.findByEventId.mockResolvedValue([createRound()]);
		mockRoundService.findByPhaseId.mockResolvedValue([]);
		mockRoundService.remove.mockResolvedValue(true);
		mockPlayerService.batchUpsertByExternalId.mockResolvedValue({ players: [], created: 0, updated: 0 });
		mockPlayerService.reconcileMeleeSnapshot.mockResolvedValue({ players: [], created: 0, updated: 0, deactivated: 0 });
		mockPlayerFeatureMatchSyncService.syncMatchesFromPlayers.mockResolvedValue([]);
		mockFeatureMatchService.findById.mockResolvedValue(createFeatureMatch());
		mockImportedMtgCardResolverService.resolveBatch.mockResolvedValue({ resolutions: new Map() });
		mockMtgCardService.batchUpsert.mockResolvedValue(new Map());
		mockPlayerDeckService.replaceMeleeDecksForEvent.mockResolvedValue(undefined);
		mockPublishMessage.mockResolvedValue(undefined);
		mockGetOriginConnectionId.mockReturnValue('origin-1');
		mockRecordMeleeSyncSuccess.mockResolvedValue(true);
		mockRecordMeleeSyncFailure.mockResolvedValue(true);
		mockAcquireMeleeSyncLease.mockResolvedValue({
			token: 'lease-token',
			command: 'players',
			expiresAt: new Date('2026-01-01T00:15:00.000Z'),
		});
		mockReleaseMeleeSyncLease.mockResolvedValue(true);
		mockRenewMeleeSyncLease.mockResolvedValue(true);
		mockRequireMeleeService.mockReturnValue({
			fetchEvent: vi.fn().mockResolvedValue({ Name: 'Melee Event', Game: 'Magic: The Gathering', Phases: [] }),
			fetchMergedPlayers: vi.fn().mockResolvedValue([]),
		});
		mockSyncMatchesFromMelee.mockResolvedValue({ matchCount: 2, created: 1, updated: 1, staleDeleted: 0 });
		mockEventService.findById.mockResolvedValue(eventData);
		mockEventService.tryAcquireLiveRefreshLease.mockResolvedValue(true);
	});

	it('loads Melee Sync Event data inside the command seam', async () => {
		const melee = {
			fetchEvent: vi.fn().mockResolvedValue({ Name: 'Melee Event', Game: 'Magic: The Gathering', Phases: [] }),
			fetchMergedPlayers: vi.fn().mockResolvedValue([createMeleePlayer()]),
		};
		mockRequireMeleeService.mockReturnValue(melee);
		mockPlayerService.reconcileMeleeSnapshot.mockResolvedValue({
			players: [{ id: 10, externalId: 'player-1' }],
			created: 1,
			updated: 0,
			deactivated: 0,
		});

		const result = await meleeSyncModule().syncPlayers(requestEvent, 1);

		expect(mockEventService.findById).toHaveBeenCalledWith(1);
		expect(mockRequireMeleeService).toHaveBeenCalledWith(eventData);
		expect(result.results).toEqual({ created: 1, updated: 0, deactivated: 0, matchesUpdated: 0, errors: [] });
		expect(mockAcquireMeleeSyncLease).toHaveBeenCalledWith(1, 'players');
		expect(mockRecordMeleeSyncSuccess).toHaveBeenCalledOnce();
		expect(mockRecordMeleeSyncFailure).not.toHaveBeenCalled();
		expect(mockReleaseMeleeSyncLease).toHaveBeenCalledWith(1, 'lease-token');
		expect(mockPublishMessage).toHaveBeenCalledOnce();
		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'melee:playersSynced', {
			playerCount: 1,
		}, 'origin-1');
	});

	it('reports Melee players deactivated by authoritative snapshot reconciliation', async () => {
		mockRequireMeleeService.mockReturnValue({
			fetchEvent: vi.fn().mockResolvedValue({ Name: 'Melee Event', Game: 'Magic: The Gathering', Phases: [] }),
			fetchMergedPlayers: vi.fn().mockResolvedValue([createMeleePlayer()]),
		});
		mockPlayerService.reconcileMeleeSnapshot.mockResolvedValue({
			players: [{ id: 10, externalId: 'player-1' }],
			created: 0,
			updated: 1,
			deactivated: 2,
		});

		const result = await meleeSyncModule().syncPlayers(requestEvent, 1);

		expect(mockPlayerService.reconcileMeleeSnapshot).toHaveBeenCalledWith(
			1,
			[expect.objectContaining({
				externalId: 'player-1',
				externalStatus: null,
				name: 'Alice',
			})],
			expect.any(Date),
		);
		expect(result.results.deactivated).toBe(2);
		expect(result.message).toContain('deactivated 2 missing players');
	});

	it('returns 404 when the command seam cannot load the Event', async () => {
		mockEventService.findById.mockResolvedValue(null);

		await expect(meleeSyncModule().syncPlayers(requestEvent, 999)).rejects.toMatchObject({
			statusCode: 404,
			message: 'Event not found',
		});
	});

	it('syncs Event structure and publishes one aggregate change set after persistence', async () => {
		const melee = {
			fetchEvent: vi.fn().mockResolvedValue({
				Name: 'Melee Championship',
				Game: 'Magic: The Gathering',
				Phases: [
					{ ID: 100, Name: 'Swiss', FormatId: 'modern', SortOrder: 0, Rounds: [{ ID: 1001, Name: 'Round 1', SortOrder: 0 }, { ID: 1002, Name: 'Round 2', SortOrder: 1 }] },
					{ ID: 200, Name: 'Top Cut', FormatId: 'modern', SortOrder: 1, Rounds: [] },
				],
			}),
		};
		mockRequireMeleeService.mockReturnValue(melee);
		mockPhaseService.findByEventId.mockResolvedValue([createPhase({ id: 9, name: 'Old Phase', externalId: 'stale-phase' })]);
		mockRoundService.findByEventId.mockResolvedValue([createRound({ id: 19, phaseId: 9, externalId: 'stale-round' })]);

		const result = await meleeSyncModule().syncEventStructure(requestEvent, 1);

		expect(mockPhaseService.remove).toHaveBeenCalledWith(9, 1);
		expect(mockRoundService.remove).toHaveBeenCalledWith(19, 1);
		expect(mockPhaseService.upsertByExternalId).toHaveBeenCalledWith({
			eventId: 1,
			name: 'Swiss',
			sortOrder: 0,
			externalId: '100',
			externalSource: 'melee',
			formatExternalId: 'modern',
		});
		expect(mockRoundService.upsertByExternalId).toHaveBeenCalledWith({
			eventId: 1,
			phaseId: 2,
			name: 'Round 1',
			roundNumber: 1,
			externalId: '1001',
			externalSource: 'melee',
		});
		expect(mockPublishMessage).toHaveBeenCalledOnce();
		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'melee:structureSynced', {
			phaseCount: 2,
			roundCount: 2,
			changes: {
				phases: { created: [2], updated: [3], deleted: [9] },
				rounds: { created: [10], updated: [11], deleted: [19] },
			},
		}, 'origin-1');
		expect(mockPublishMessage.mock.invocationCallOrder[0]).toBeGreaterThan(
			mockPhaseService.remove.mock.invocationCallOrder[0]!,
		);
		expect(mockRecordMeleeSyncSuccess).toHaveBeenCalledWith(requestEvent, 1, { lastEventSyncedAt: expect.any(Date) }, 'lease-token');
		expect(result).toEqual({
			success: true,
			message: 'Synced event structure from Melee.gg',
			event: { name: 'Melee Championship', game: 'Magic: The Gathering' },
			phases: 2,
			rounds: 2,
		});
	});

	it('does not rewrite or publish unchanged Event structure', async () => {
		mockRequireMeleeService.mockReturnValue({
			fetchEvent: vi.fn().mockResolvedValue({
				Name: 'Melee Championship',
				Game: 'Magic: The Gathering',
				Phases: [{
					ID: 100,
					Name: 'Swiss',
					FormatId: 'modern',
					SortOrder: 0,
					Rounds: [
						{ ID: 1001, Name: 'Round 1', SortOrder: 0 },
						{ ID: 1002, Name: 'Round 2', SortOrder: 1 },
					],
				}],
			}),
		});
		mockPhaseService.findByEventId.mockResolvedValue([createPhase()]);
		mockRoundService.findByEventId.mockResolvedValue([
			createRound(),
			createRound({ id: 11, externalId: '1002', name: 'Round 2', roundNumber: 2 }),
		]);

		const result = await meleeSyncModule().syncEventStructure(requestEvent, 1);

		expect(mockPhaseService.upsertByExternalId).not.toHaveBeenCalled();
		expect(mockRoundService.upsertByExternalId).not.toHaveBeenCalled();
		expect(mockPhaseService.remove).not.toHaveBeenCalled();
		expect(mockRoundService.remove).not.toHaveBeenCalled();
		expect(mockPublishMessage).not.toHaveBeenCalled();
		expect(result).toMatchObject({ success: true, phases: 1, rounds: 2 });
	});

	it('publishes one aggregate Feature Match invalidation after player projections are durable', async () => {
		mockRequireMeleeService.mockReturnValue({
			fetchEvent: vi.fn().mockResolvedValue({ Name: 'Melee Event', Game: 'Magic: The Gathering', Phases: [] }),
			fetchMergedPlayers: vi.fn().mockResolvedValue([createMeleePlayer()]),
		});
		mockPlayerService.reconcileMeleeSnapshot.mockResolvedValue({
			players: [{ id: 10, externalId: 'player-1' }],
			created: 0,
			updated: 1,
			deactivated: 0,
		});
		mockPlayerFeatureMatchSyncService.syncMatchesFromPlayers.mockResolvedValue([20, 21]);

		const result = await meleeSyncModule().syncPlayers(requestEvent, 1);

		expect(mockPublishMessage).toHaveBeenCalledTimes(2);
		expect(mockPublishMessage).toHaveBeenNthCalledWith(1, 1, 'melee:featureMatchesSynced', {
			slotIds: [20, 21],
		}, 'origin-1');
		expect(mockPublishMessage).toHaveBeenNthCalledWith(2, 1, 'melee:playersSynced', {
			playerCount: 1,
		}, 'origin-1');
		expect(mockPublishMessage.mock.invocationCallOrder[0]).toBeGreaterThan(
			mockPlayerFeatureMatchSyncService.syncMatchesFromPlayers.mock.invocationCallOrder[0]!,
		);
		expect(result.results.matchesUpdated).toBe(2);
	});

	it('keeps a completed player sync successful when realtime publication fails', async () => {
		const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		mockRequireMeleeService.mockReturnValue({
			fetchEvent: vi.fn().mockResolvedValue({ Name: 'Melee Event', Game: 'Magic: The Gathering', Phases: [] }),
			fetchMergedPlayers: vi.fn().mockResolvedValue([createMeleePlayer()]),
		});
		mockPlayerService.reconcileMeleeSnapshot.mockResolvedValue({
			players: [{ id: 10, externalId: 'player-1' }],
			created: 1,
			updated: 0,
			deactivated: 0,
		});
		mockPublishMessage.mockRejectedValueOnce(new Error('Ably unavailable'));

		const result = await meleeSyncModule().syncPlayers(requestEvent, 1);

		expect(result).toEqual(expect.objectContaining({
			success: true,
			results: { created: 1, updated: 0, deactivated: 0, matchesUpdated: 0, errors: [] },
			warnings: ['Data was saved, but realtime notification "melee:playersSynced" could not be delivered'],
		}));
		expect(mockRecordMeleeSyncSuccess).toHaveBeenCalledOnce();
		expect(mockRecordMeleeSyncFailure).not.toHaveBeenCalled();
		consoleSpy.mockRestore();
	});

	it('preserves Match sync warnings when realtime publication also fails', async () => {
		const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		mockRoundService.findById.mockResolvedValue(createRound());
		mockSyncMatchesFromMelee.mockResolvedValue({
			success: true,
			message: 'Synced Round 1',
			round: { id: 10, name: 'Round 1', roundNumber: 1, phaseId: 2 },
			matchCount: 2,
			created: 1,
			updated: 1,
			staleDeleted: 0,
			warnings: ['A player deck could not be selected'],
		});
		mockPublishMessage
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(new Error('Ably unavailable'));

		const result = await meleeSyncModule().syncRoundMatches(requestEvent, 1, 10);

		expect(result).toEqual(expect.objectContaining({
			success: true,
			warnings: [
				'A player deck could not be selected',
				'Data was saved, but realtime notification "melee:roundSynced" could not be delivered',
			],
		}));
		expect(mockRecordMeleeSyncSuccess).toHaveBeenCalledOnce();
		expect(mockRecordMeleeSyncFailure).not.toHaveBeenCalled();
		// The composite round command publishes the player reconciliation first;
		// the second publication is the round delta under test here.
		expect(mockPublishMessage.mock.invocationCallOrder[1]).toBeGreaterThan(
			mockSyncMatchesFromMelee.mock.invocationCallOrder[0]!,
		);
		consoleSpy.mockRestore();
	});

	it('syncs Deck Lists, records unresolved cards, and returns warnings without blocking resolved cards', async () => {
		const melee = {
			fetchPlayers: vi.fn().mockResolvedValue([{
				TeamId: 1,
				PlayerName: 'Alice',
				PronounsDescription: null,
				Decklists: [{
					Guid: 'deck-burn',
					FormatId: 'modern',
					DecklistName: 'Burn',
					Records: [
						{ l: 'lightning-bolt', n: 'Lightning Bolt', s: '2X2', q: 4, c: 0, t: 'Instant' },
						{ l: 'mystery-card', n: 'Mystery Card', s: null, q: 1, c: 99, t: 'Creature' },
					],
					Attributes: [{ k: 'COLOR_RED', v: 'True', p: null }],
				}],
			}]),
			fetchEvent: vi.fn().mockResolvedValue({ Name: 'Melee Event', Game: 'Magic: The Gathering', Phases: [{ ID: 100, Name: 'Swiss', FormatId: 'modern', SortOrder: 0, Rounds: [] }] }),
		};
		mockRequireMeleeService.mockReturnValue(melee);
		mockImportedMtgCardResolverService.resolveBatch.mockResolvedValue({
			resolutions: new Map([
				['lightning bolt|2x2', {
					status: 'resolved',
					source: 'exact',
					inputName: 'Lightning Bolt',
					inputSetCode: '2X2',
					resolvedName: 'Lightning Bolt',
					cardData: { name: 'Lightning Bolt', setCode: '2x2', id: 'scryfall-bolt', oracleId: 'oracle-bolt', manaCost: '{R}', cmc: 1, colors: 'R', typeLine: 'Instant' },
					overrideCard: null,
				}],
				['mystery card', { status: 'unresolved', inputName: 'Mystery Card', inputSetCode: null }],
			]),
		});
		mockMtgCardService.batchUpsert.mockResolvedValue(new Map([
			['lightning bolt', createCard()],
		]));
		mockPlayerService.batchUpsertByExternalId.mockResolvedValue({
			players: [{ id: 10, externalId: '1' }],
			updated: 1,
		});

		const result = await meleeSyncModule().syncDeckLists(requestEvent, 1);

		expect(mockImportedMtgCardResolverService.resolveBatch).toHaveBeenCalledWith(1, expect.arrayContaining([
			{ name: 'Lightning Bolt', setCode: '2X2' },
			{ name: 'Mystery Card', setCode: null },
		]));
		expect(mockMtgCardService.batchUpsert).toHaveBeenCalledWith([
			expect.objectContaining({ name: 'Lightning Bolt', scryfallId: 'scryfall-bolt', manaCost: '{R}' }),
		]);
		expect(mockPlayerDeckService.replaceMeleeDecksForEvent).toHaveBeenCalledWith(1, [{ playerId: 10, snapshots: [{
			deck: {
				eventId: 1,
				playerId: 10,
				externalId: 'deck-burn',
				formatExternalId: 'modern',
				name: 'Burn',
				colors: 'R',
				sortOrder: 0,
				isPrimary: true,
			},
			cards: [
				{ cardId: 501, quantity: 4, compartment: 'mainboard', sortOrder: 1 },
			],
			unresolvedCards: [
				expect.objectContaining({ originalName: 'Mystery Card', normalizedOriginalName: 'mystery card', entryType: 'card' }),
			],
			importedCompanion: { action: 'clear' },
		}] }]);
		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'melee:decklistsSynced', {
			playerCount: 1,
			deckCount: 1,
		}, 'origin-1');
		expect(mockRecordMeleeSyncSuccess).toHaveBeenCalledWith(requestEvent, 1, {
			lastDecklistsSyncedAt: expect.any(Date),
		}, 'lease-token');
		expect(result).toMatchObject({
			success: true,
			results: {
				players: 1,
				deckLists: 1,
				uniqueCards: 1,
				updated: 1,
				skippedPlayers: 0,
				skippedCards: 1,
				unresolvedCards: 1,
			},
			warnings: ['1 deck entry remains unresolved and can be fixed from the Sync page'],
		});
	});

	it('rejects non-MTG Deck List sync without changing cards, player game data, decks, or sync metadata', async () => {
		const fetchPlayers = vi.fn();
		mockEventService.findById.mockResolvedValue({ ...eventData, game: 'op' });
		mockRequireMeleeService.mockReturnValue({
			fetchEvent: vi.fn().mockResolvedValue({ Name: 'OP Event', Game: 'One Piece Card Game', Phases: [] }),
			fetchPlayers,
		});

		await expect(meleeSyncModule().syncDeckLists(requestEvent, 1)).rejects.toMatchObject({
			statusCode: 422,
			data: { code: 'MELEE_DECKLIST_GAME_UNSUPPORTED' },
		});

		expect(fetchPlayers).not.toHaveBeenCalled();
		expect(mockImportedMtgCardResolverService.resolveBatch).not.toHaveBeenCalled();
		expect(mockMtgCardService.batchUpsert).not.toHaveBeenCalled();
		expect(mockPlayerService.batchUpsertByExternalId).not.toHaveBeenCalled();
		expect(mockPlayerDeckService.replaceMeleeDecksForEvent).not.toHaveBeenCalled();
		expect(mockRecordMeleeSyncSuccess).not.toHaveBeenCalled();
		expect(mockRecordMeleeSyncFailure).toHaveBeenCalledWith(
			requestEvent,
			1,
			expect.objectContaining({ statusCode: 422 }),
			{},
			'lease-token',
		);
	});

	it('preserves the prior deck snapshot and timestamp when card enrichment is unavailable', async () => {
		const lookupFailure = Object.assign(new Error('Card data lookup is temporarily unavailable; existing deck data was preserved'), {
			code: 'IMPORTED_CARD_LOOKUP_UNAVAILABLE',
		});
		mockRequireMeleeService.mockReturnValue({
			fetchEvent: vi.fn().mockResolvedValue({ Name: 'Melee Event', Game: 'Magic: The Gathering', Phases: [] }),
			fetchPlayers: vi.fn().mockResolvedValue([{
				TeamId: 1,
				PlayerName: 'Alice',
				PronounsDescription: null,
				Decklists: [],
			}]),
		});
		mockImportedMtgCardResolverService.resolveBatch.mockRejectedValue(lookupFailure);

		await expect(meleeSyncModule().syncDeckLists(requestEvent, 1)).rejects.toBe(lookupFailure);

		expect(mockMtgCardService.batchUpsert).not.toHaveBeenCalled();
		expect(mockPlayerService.batchUpsertByExternalId).not.toHaveBeenCalled();
		expect(mockPlayerDeckService.replaceMeleeDecksForEvent).not.toHaveBeenCalled();
		expect(mockRecordMeleeSyncSuccess).not.toHaveBeenCalled();
		expect(mockRecordMeleeSyncFailure).toHaveBeenCalledWith(requestEvent, 1, lookupFailure, {}, 'lease-token');
	});

	it('clears stale imported deck slots when a player no longer has a deck list', async () => {
		mockRequireMeleeService.mockReturnValue({
			fetchPlayers: vi.fn().mockResolvedValue([{
				TeamId: 1,
				PlayerName: 'Alice',
				PronounsDescription: null,
				Decklists: [],
			}]),
			fetchEvent: vi.fn().mockResolvedValue({ Name: 'Melee Event', Game: 'Magic: The Gathering', Phases: [] }),
		});
		mockPlayerService.batchUpsertByExternalId.mockResolvedValue({
			players: [{ id: 10, externalId: '1' }],
			updated: 1,
		});

		const result = await meleeSyncModule().syncDeckLists(requestEvent, 1);

		expect(mockPlayerService.batchUpsertByExternalId).toHaveBeenCalledWith([
			expect.not.objectContaining({ gameData: expect.anything() }),
		]);
		expect(mockPlayerDeckService.replaceMeleeDecksForEvent).toHaveBeenCalledWith(1, [{ playerId: 10, snapshots: [] }]);
		expect(result).toMatchObject({ success: true, results: { players: 1, deckLists: 0 } });
	});
});
