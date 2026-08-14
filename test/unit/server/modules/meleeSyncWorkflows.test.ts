import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lastCallTo } from '~~/test/helpers/lastCallTo';
import { providerRefusal } from '~~/test/helpers/providerRefusal';

/** #264's publish-failure line, told apart from anything else a sync run logs. */
function isPublishFailureLine(call: unknown[]): boolean {
	const [line] = call;
	return typeof line === 'string' && line.includes('"message":"melee_sync_realtime_publish_failed"');
}

const mockMelee = {
	fetchMergedPlayers: vi.fn(),
	fetchPlayers: vi.fn(),
	fetchCurrentStandings: vi.fn(),
	fetchEvent: vi.fn(),
};
const mockRequireMeleeService = vi.fn(() => mockMelee);
const mockSyncMatchesFromMelee = vi.fn();
const mockRoundService = {
	findByEventId: vi.fn(),
	findById: vi.fn(),
	upsertByExternalId: vi.fn(),
	remove: vi.fn(),
};
const mockPhaseService = {
	findById: vi.fn(),
	findByEventId: vi.fn(),
	upsertByExternalId: vi.fn(),
	remove: vi.fn(),
};
const mockPlayerService = { batchUpsertByExternalId: vi.fn(), reconcileMeleeSnapshot: vi.fn() };
const mockPlayerDeckService = { reconcilePrimaryArchetype: vi.fn() };
const mockPlayerFeatureMatchSyncService = {
	syncMatchesFromPlayers: vi.fn(),
	syncMatchesFromPlayersAfterCommit: vi.fn(),
};
const mockFeatureMatchService = { findById: vi.fn() };
const mockImportedResolver = { resolveBatch: vi.fn() };
const mockMtgCardService = { batchUpsert: vi.fn() };
const mockPersistPlayerDeckLists = vi.fn();

const mockRefreshBindings = vi.fn();

vi.mock('~~/server/modules/broadcast-graphics-live-session', () => ({
	refreshBroadcastGraphicsBindings: mockRefreshBindings,
}));

vi.mock('~~/server/services/meleeIntegration', () => ({
	requireMeleeService: mockRequireMeleeService,
}));

vi.mock('~~/server/modules/melee-sync/roundMatches', () => ({
	syncMatchesFromMelee: mockSyncMatchesFromMelee,
}));

vi.mock('~~/server/services/round', () => ({
	roundService: () => mockRoundService,
}));

vi.mock('~~/server/services/phase', () => ({
	phaseService: () => mockPhaseService,
}));

vi.mock('~~/server/services/player', () => ({
	playerService: () => mockPlayerService,
}));

vi.mock('~~/server/services/playerDeck', () => ({
	playerDeckService: () => mockPlayerDeckService,
}));

vi.mock('~~/server/services/playerFeatureMatchSync', () => ({
	playerFeatureMatchSyncService: () => mockPlayerFeatureMatchSyncService,
}));

vi.mock('~~/server/services/featureMatch', () => ({
	featureMatchService: () => mockFeatureMatchService,
}));

vi.mock('~~/server/services/event', () => ({
	eventService: () => ({}),
}));

vi.mock('~~/server/services/importedMtgCardResolver', () => ({
	importedMtgCardResolverService: () => mockImportedResolver,
}));

vi.mock('~~/server/services/mtgCard', () => ({
	mtgCardService: () => mockMtgCardService,
}));

vi.mock('~~/server/utils/meleeSyncState', () => ({
	recordMeleeSyncFailure: vi.fn(),
	recordMeleeSyncSuccess: vi.fn(),
}));

vi.mock('~~/server/utils/ably', () => ({
	getOriginConnectionId: vi.fn(() => undefined),
	publishMessage: vi.fn(),
	publishMessageStrict: vi.fn(),
}));

vi.mock('~~/server/mappers/featureMatch', () => ({
	mapFeatureMatchToResponse: vi.fn(match => match),
}));

vi.mock('~~/server/modules/melee-sync/deckLists', () => ({
	buildPlayersWithDeckLists: vi.fn((eventId, players) => players.map((player: any) => ({ playerData: { eventId, ...player }, deckLists: [] }))),
	buildResolvedCardUpserts: vi.fn(() => new Map()),
	collectImportedDeckCards: vi.fn(() => ({ cards: [], totalDeckLists: 0 })),
	createImportedCardResolver: vi.fn(() => vi.fn()),
	persistPlayerDeckLists: mockPersistPlayerDeckLists,
}));

const { createMeleeSyncWorkflows } = await import('~~/server/modules/melee-sync/workflows');

const eventData = {
	game: 'mtg' as const,
	meleeEnabled: true,
	meleeEventId: 'melee-1',
	meleeClientId: 'client',
	meleeClientSecret: 'secret',
	lastDecklistsSyncedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const round1 = { id: 1, eventId: 1, phaseId: 10, name: 'Round 1', roundNumber: 1, externalId: '101', externalSource: 'melee', lastSyncedAt: new Date('2026-01-01T01:00:00.000Z') };
const round2 = { id: 2, eventId: 1, phaseId: 10, name: 'Round 2', roundNumber: 2, externalId: '102', externalSource: 'melee', lastSyncedAt: null };
const syncedRound2 = { ...round2, lastSyncedAt: new Date('2026-01-01T02:00:00.000Z') };

function matchResult(round: typeof round1, matchCount = 4) {
	return {
		success: true,
		message: `Synced ${round.name}`,
		round: { id: round.id, name: round.name, roundNumber: round.roundNumber, phaseId: round.phaseId },
		matchCount,
		created: matchCount,
		updated: 0,
		staleDeleted: 0,
		warnings: [],
	};
}

describe('melee Sync updateFromMelee workflow', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockMelee.fetchMergedPlayers.mockResolvedValue([]);
		mockMelee.fetchPlayers.mockResolvedValue([]);
		mockMelee.fetchCurrentStandings.mockResolvedValue([]);
		mockMelee.fetchEvent.mockResolvedValue({
			ID: 1,
			Name: 'Event',
			Game: 'Magic: The Gathering',
			Phases: [{
				ID: 10,
				Name: 'Swiss',
				FormatId: 'modern',
				SortOrder: 0,
				Rounds: [
					{ ID: 101, Name: 'Round 1', SortOrder: 0 },
					{ ID: 102, Name: 'Round 2', SortOrder: 1 },
				],
			}],
		});
		mockPhaseService.findByEventId.mockResolvedValue([]);
		mockPhaseService.upsertByExternalId.mockResolvedValue({ phase: { id: 10, eventId: 1, name: 'Swiss' }, created: false });
		mockPhaseService.remove.mockResolvedValue(true);
		mockRoundService.upsertByExternalId.mockImplementation(async input => ({
			round: input.externalId === '101' ? round1 : round2,
			created: false,
		}));
		mockRoundService.remove.mockResolvedValue(true);
		mockPlayerService.batchUpsertByExternalId.mockResolvedValue({ players: [], created: 0, updated: 0 });
		mockPlayerService.reconcileMeleeSnapshot.mockResolvedValue({ players: [], created: 0, updated: 0, deactivated: 0 });
		mockPlayerFeatureMatchSyncService.syncMatchesFromPlayers.mockResolvedValue([]);
		mockPlayerFeatureMatchSyncService.syncMatchesFromPlayersAfterCommit.mockResolvedValue([]);
		mockImportedResolver.resolveBatch.mockResolvedValue({ resolutions: new Map() });
		mockMtgCardService.batchUpsert.mockResolvedValue(new Map());
		mockPersistPlayerDeckLists.mockResolvedValue({ skippedPlayers: 0, unresolvedCards: 0 });
		mockRoundService.findById.mockImplementation(async (id: number) => [round1, round2, syncedRound2].find(round => round.id === id));
		mockPhaseService.findById.mockResolvedValue({ id: 10, eventId: 1, name: 'Swiss' });
		mockSyncMatchesFromMelee.mockImplementation(async (_eventId, _eventData, round) => matchResult(round));
	});

	it('runs initial setup from one upstream snapshot without importing Round Matches', async () => {
		mockRoundService.findByEventId.mockResolvedValue([]);
		const checkpoint = vi.fn().mockResolvedValue(undefined);

		const result = await createMeleeSyncWorkflows().runInitialSetup({} as any, 1, eventData, checkpoint);

		expect(mockMelee.fetchEvent).toHaveBeenCalledOnce();
		expect(mockMelee.fetchPlayers).toHaveBeenCalledOnce();
		expect(mockMelee.fetchCurrentStandings).toHaveBeenCalledOnce();
		expect(mockMelee.fetchMergedPlayers).not.toHaveBeenCalled();
		expect(mockPlayerService.reconcileMeleeSnapshot).toHaveBeenCalledOnce();
		expect(mockPlayerService.batchUpsertByExternalId).toHaveBeenCalledOnce();
		expect(mockSyncMatchesFromMelee).not.toHaveBeenCalled();
		expect(checkpoint).toHaveBeenCalledTimes(3);
		expect(result).toEqual(expect.objectContaining({
			success: true,
			steps: ['structure', 'players', 'decklists'],
			phases: 1,
			rounds: 2,
		}));
	});

	it('names the provider refusal behind a notification it could not deliver', async () => {
		// #264, the smallest of the cluster: the warning kept only the message type,
		// so a sync that quietly stopped notifying anybody said 'could not be
		// delivered' and nothing about why. Under a rejected key that is once per
		// published stage, forever, with the answer — 40400 — thrown away each time.
		//
		// The real extraction runs here: `publishFailureFields` deliberately lives
		// outside the mocked `~~/server/utils/ably`, so this asserts what the log
		// carries rather than what a stub was told to return.
		mockRoundService.findByEventId.mockResolvedValue([]);
		const ably = await import('~~/server/utils/ably');
		vi.mocked(ably.publishMessageStrict).mockRejectedValueOnce(providerRefusal());
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const result = await createMeleeSyncWorkflows().runInitialSetup({} as any, 1, eventData, vi.fn().mockResolvedValue(undefined));

		// Named rather than taken from position 0: `console.warn` is nobody's private
		// channel, so the first line this run logged need not be the publish failure —
		// and a run that logged nothing at all indexed past the end and died as a type
		// crash naming neither the spy nor the expectation (#273, #280, swept in #342).
		const [line] = lastCallTo(warnSpy, isPublishFailureLine);
		expect(JSON.parse(line as string)).toEqual({
			message: 'melee_sync_realtime_publish_failed',
			messageType: 'melee:structureSynced',
			statusCode: 404,
			errorCode: 40400,
			errorName: 'Error',
			reason: 'No application found',
		});
		// The sync still reports success with a warning: the data committed, and
		// only the notification was lost. #264 changed the log line, not that.
		expect(result.success).toBe(true);
		expect(result.warnings).toContain('Data was saved, but realtime notification "melee:structureSynced" could not be delivered');
		warnSpy.mockRestore();
	});

	it('stops an aggregate update before the next durable stage when its ownership checkpoint fails', async () => {
		const ownershipLost = new Error('lease ownership lost');
		const checkpoint = vi.fn()
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(ownershipLost);

		await expect(
			createMeleeSyncWorkflows().updateFromMelee({} as any, 1, eventData, {}, checkpoint),
		).rejects.toBe(ownershipLost);

		expect(checkpoint).toHaveBeenCalledTimes(2);
		expect(mockPhaseService.upsertByExternalId).toHaveBeenCalled();
		expect(mockPlayerService.reconcileMeleeSnapshot).not.toHaveBeenCalled();
		expect(mockSyncMatchesFromMelee).not.toHaveBeenCalled();
	});

	it('rejects duplicate phase identities before writing any structure', async () => {
		mockMelee.fetchEvent.mockResolvedValue({
			ID: 1,
			Name: 'Event',
			Game: 'Magic: The Gathering',
			Phases: [
				{ ID: 10, Name: 'Swiss A', FormatId: 'modern', SortOrder: 0, Rounds: [] },
				{ ID: 10, Name: 'Swiss B', FormatId: 'modern', SortOrder: 1, Rounds: [] },
			],
		});

		await expect(
			createMeleeSyncWorkflows().syncEventStructure({} as any, 1, eventData),
		)
			.rejects
			.toThrow('Duplicate Melee phase external identity: 10');

		expect(mockPhaseService.findByEventId).not.toHaveBeenCalled();
		expect(mockPhaseService.upsertByExternalId).not.toHaveBeenCalled();
		expect(mockRoundService.upsertByExternalId).not.toHaveBeenCalled();
	});

	it('rejects duplicate round identities across phases before writing any structure', async () => {
		mockMelee.fetchEvent.mockResolvedValue({
			ID: 1,
			Name: 'Event',
			Game: 'Magic: The Gathering',
			Phases: [
				{
					ID: 10,
					Name: 'Swiss',
					FormatId: 'modern',
					SortOrder: 0,
					Rounds: [{ ID: 101, Name: 'Round 1', SortOrder: 0 }],
				},
				{
					ID: 11,
					Name: 'Top Cut',
					FormatId: 'modern',
					SortOrder: 1,
					Rounds: [{ ID: 101, Name: 'Quarterfinals', SortOrder: 0 }],
				},
			],
		});

		await expect(
			createMeleeSyncWorkflows().syncEventStructure({} as any, 1, eventData),
		)
			.rejects
			.toThrow('Duplicate Melee round external identity: 101');

		expect(mockPhaseService.findByEventId).not.toHaveBeenCalled();
		expect(mockPhaseService.upsertByExternalId).not.toHaveBeenCalled();
		expect(mockRoundService.upsertByExternalId).not.toHaveBeenCalled();
	});

	it('defensively rejects a missing Round before fetching or replacing Matches', async () => {
		mockRoundService.findById.mockResolvedValue(null);

		await expect(
			createMeleeSyncWorkflows().syncRoundMatches({} as any, 1, eventData, 999),
		).rejects.toMatchObject({ statusCode: 404 });

		expect(mockPhaseService.findById).not.toHaveBeenCalled();
		expect(mockSyncMatchesFromMelee).not.toHaveBeenCalled();
	});

	it('defensively rejects a non-Melee Round before fetching or replacing Matches', async () => {
		mockRoundService.findById.mockResolvedValue({
			...round1,
			externalId: null,
			externalSource: null,
		});

		await expect(
			createMeleeSyncWorkflows().syncRoundMatches({} as any, 1, eventData, round1.id),
		).rejects.toMatchObject({ statusCode: 400 });

		expect(mockPhaseService.findById).not.toHaveBeenCalled();
		expect(mockSyncMatchesFromMelee).not.toHaveBeenCalled();
	});

	it('reports only completed setup steps when Deck List persistence throws', async () => {
		mockRoundService.findByEventId.mockResolvedValue([]);
		mockPersistPlayerDeckLists.mockRejectedValueOnce(new Error('Deck persistence failed'));
		const progress: Array<Record<string, Date>> = [];

		await expect(
			createMeleeSyncWorkflows().runInitialSetup(
				{} as any,
				1,
				eventData,
				undefined,
				metadata => progress.push(metadata as Record<string, Date>),
			),
		).rejects.toThrow('Deck persistence failed');

		expect(progress).toEqual([
			{ lastEventSyncedAt: expect.any(Date) },
			{ lastPlayersSyncedAt: expect.any(Date) },
		]);
	});

	it('does not mutate cards, players, or decks when card lookup is unavailable', async () => {
		const lookupFailure = Object.assign(new Error('private Scryfall detail'), {
			code: 'IMPORTED_CARD_LOOKUP_UNAVAILABLE',
		});
		mockImportedResolver.resolveBatch.mockRejectedValueOnce(lookupFailure);

		await expect(
			createMeleeSyncWorkflows().syncDeckLists({} as any, 1, eventData),
		).rejects.toBe(lookupFailure);

		expect(mockMtgCardService.batchUpsert).not.toHaveBeenCalled();
		expect(mockPlayerService.batchUpsertByExternalId).not.toHaveBeenCalled();
		expect(mockPersistPlayerDeckLists).not.toHaveBeenCalled();
	});

	it('rejects a standalone Deck List sync for a non-MTG Event before enrichment or persistence', async () => {
		mockMelee.fetchEvent.mockResolvedValue({ ID: 1, Name: 'OP Event', Game: 'One Piece Card Game', Phases: [] });

		await expect(
			createMeleeSyncWorkflows().syncDeckLists({} as any, 1, { ...eventData, game: 'op' }),
		).rejects.toMatchObject({
			statusCode: 422,
			data: { code: 'MELEE_DECKLIST_GAME_UNSUPPORTED' },
		});

		expect(mockMelee.fetchPlayers).not.toHaveBeenCalled();
		expect(mockImportedResolver.resolveBatch).not.toHaveBeenCalled();
		expect(mockMtgCardService.batchUpsert).not.toHaveBeenCalled();
		expect(mockPlayerService.batchUpsertByExternalId).not.toHaveBeenCalled();
		expect(mockPersistPlayerDeckLists).not.toHaveBeenCalled();
	});

	it('skips Deck Lists during aggregate setup for a supported source game without an import adapter', async () => {
		mockMelee.fetchEvent.mockResolvedValue({ ID: 1, Name: 'OP Event', Game: 'One Piece Card Game', Phases: [] });
		mockRoundService.findByEventId.mockResolvedValue([]);
		const progress: Array<Record<string, Date>> = [];

		const result = await createMeleeSyncWorkflows().runInitialSetup(
			{} as any,
			1,
			{ ...eventData, game: 'op' },
			undefined,
			metadata => progress.push(metadata as Record<string, Date>),
		);

		expect(result).toMatchObject({
			success: true,
			deckListsSkipped: true,
			deckLists: { players: 0, deckLists: 0 },
			warnings: ['Melee.gg Deck List import is not yet supported for this Event game'],
		});
		expect(progress).toEqual([
			{ lastEventSyncedAt: expect.any(Date) },
			{ lastPlayersSyncedAt: expect.any(Date) },
		]);
		expect(mockImportedResolver.resolveBatch).not.toHaveBeenCalled();
		expect(mockMtgCardService.batchUpsert).not.toHaveBeenCalled();
		expect(mockPersistPlayerDeckLists).not.toHaveBeenCalled();
	});

	it('rejects a known upstream game mismatch before aggregate writes', async () => {
		mockMelee.fetchEvent.mockResolvedValue({ ID: 1, Name: 'Wrong Event', Game: 'One Piece Card Game', Phases: [] });

		await expect(
			createMeleeSyncWorkflows().runInitialSetup({} as any, 1, eventData),
		).rejects.toMatchObject({
			statusCode: 422,
			data: { code: 'MELEE_GAME_MISMATCH' },
		});

		expect(mockPhaseService.findByEventId).not.toHaveBeenCalled();
		expect(mockPlayerService.reconcileMeleeSnapshot).not.toHaveBeenCalled();
		expect(mockImportedResolver.resolveBatch).not.toHaveBeenCalled();
	});

	it('refreshes players, skips deck lists by default when already synced, and advances the next round after refreshing the previous round', async () => {
		mockRoundService.findByEventId.mockResolvedValue([round1, round2]);

		const result = await createMeleeSyncWorkflows().updateFromMelee({} as any, 1, eventData);

		expect(mockPlayerService.reconcileMeleeSnapshot).toHaveBeenCalledOnce();
		expect(mockMelee.fetchEvent).toHaveBeenCalledOnce();
		expect(mockSyncMatchesFromMelee).toHaveBeenCalledTimes(2);
		expect(mockSyncMatchesFromMelee.mock.calls.map(call => call[2].id)).toEqual([1, 2]);
		expect(result.steps).toEqual(['structure', 'players', 'previous-round', 'next-round']);
		expect(result.refreshedRound?.id).toBe(1);
		expect(result.advancedRound?.id).toBe(2);
	});

	it('includes deck lists when requested', async () => {
		mockRoundService.findByEventId.mockResolvedValue([round2]);

		const result = await createMeleeSyncWorkflows().updateFromMelee({} as any, 1, eventData, { includeDeckLists: true });

		expect(mockMelee.fetchEvent).toHaveBeenCalledOnce();
		expect(result.deckLists).toEqual(expect.objectContaining({ deckLists: 0, players: 0 }));
		expect(result.steps).toContain('decklists');
	});

	it('includes deck lists automatically when they have never been synced', async () => {
		mockRoundService.findByEventId.mockResolvedValue([round2]);

		await createMeleeSyncWorkflows().updateFromMelee({} as any, 1, { ...eventData, lastDecklistsSyncedAt: null });

		expect(mockMelee.fetchEvent).toHaveBeenCalledOnce();
	});

	it('refreshes the latest synced round when there is no next unsynced round', async () => {
		mockRoundService.findByEventId.mockResolvedValue([round1, syncedRound2]);

		const result = await createMeleeSyncWorkflows().updateFromMelee({} as any, 1, eventData);

		expect(mockSyncMatchesFromMelee).toHaveBeenCalledTimes(1);
		expect(mockSyncMatchesFromMelee!.mock!.calls![0]![2].id).toBe(2);
		expect(result.refreshedRound?.id).toBe(2);
		expect(result.advancedRound).toBeNull();
		expect(result.steps).toEqual(['structure', 'players', 'latest-round']);
	});

	it('reports completed update steps when a later Round refresh throws', async () => {
		mockRoundService.findByEventId.mockResolvedValue([round2]);
		mockSyncMatchesFromMelee.mockRejectedValueOnce(new Error('Round refresh failed'));
		const progress: Array<Record<string, Date>> = [];

		await expect(
			createMeleeSyncWorkflows().updateFromMelee(
				{} as any,
				1,
				eventData,
				{ includeDeckLists: true },
				undefined,
				metadata => progress.push(metadata as Record<string, Date>),
			),
		).rejects.toThrow('Round refresh failed');

		expect(progress).toEqual([
			{ lastEventSyncedAt: expect.any(Date) },
			{ lastPlayersSyncedAt: expect.any(Date) },
			{ lastDecklistsSyncedAt: expect.any(Date) },
		]);
	});

	it('reverse-syncs a Player sync through the post-commit form, so a lost Session race cannot fail a committed write', async () => {
		mockPlayerService.reconcileMeleeSnapshot.mockResolvedValue({
			players: [{ id: 10, externalId: 'player-1' }],
			created: 0,
			updated: 1,
			deactivated: 0,
		});

		await createMeleeSyncWorkflows().syncPlayers({} as any, 1, eventData);

		expect(mockPlayerFeatureMatchSyncService.syncMatchesFromPlayersAfterCommit).toHaveBeenCalledWith(1, [10]);
		expect(mockPlayerFeatureMatchSyncService.syncMatchesFromPlayers).not.toHaveBeenCalled();
	});

	it('reverse-syncs a Deck List sync through the post-commit form, so a lost Session race cannot fail a committed write', async () => {
		mockPlayerService.batchUpsertByExternalId.mockResolvedValue({
			players: [{ id: 11, externalId: 'player-2' }],
			created: 0,
			updated: 1,
		});

		await createMeleeSyncWorkflows().syncDeckLists({} as any, 1, eventData);

		expect(mockPlayerFeatureMatchSyncService.syncMatchesFromPlayersAfterCommit).toHaveBeenCalledWith(1, [11]);
		expect(mockPlayerFeatureMatchSyncService.syncMatchesFromPlayers).not.toHaveBeenCalled();
	});
});
