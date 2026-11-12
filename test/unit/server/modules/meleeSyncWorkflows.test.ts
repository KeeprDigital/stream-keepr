import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * What a setup or an update reports as done when a later stage throws. Only a
 * stand-in can make Deck List persistence or a Round refresh throw on demand;
 * what the stages store is `meleeSyncWorkflows.sqlite.test.ts`'s.
 */

const mockMelee = {
	fetchPlayers: vi.fn(),
	fetchCurrentStandings: vi.fn(),
	fetchEvent: vi.fn(),
};
const mockSyncMatchesFromMelee = vi.fn();
const mockRoundService = {
	findByEventId: vi.fn(),
	findById: vi.fn(),
	upsertByExternalId: vi.fn(),
};
const mockPhaseService = {
	findById: vi.fn(),
	findByEventId: vi.fn(),
	upsertByExternalId: vi.fn(),
};
const mockPlayerService = {
	batchUpsertByExternalId: vi.fn(),
	reconcileMeleeSnapshot: vi.fn(),
	findAll: vi.fn(),
};
const mockPersistPlayerDeckLists = vi.fn();

vi.mock('~~/server/modules/broadcast-graphics-live-session', () => ({
	refreshBroadcastGraphicsBindings: vi.fn(),
}));

vi.mock('~~/server/services/meleeIntegration', () => ({
	requireMeleeService: () => mockMelee,
}));

vi.mock('~~/server/modules/melee-sync/roundMatches', () => ({
	MeleeRoundNotReadyError: class extends Error {},
	syncMatchesFromMelee: mockSyncMatchesFromMelee,
	syncPreviousRoundStandingsFromMelee: async () => null,
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

vi.mock('~~/server/services/playerFeatureMatchSync', () => ({
	playerFeatureMatchSyncService: () => ({
		syncMatchesFromPlayersAfterCommit: async () => [],
	}),
}));

vi.mock('~~/server/services/featureMatch', () => ({
	featureMatchService: () => ({}),
}));

vi.mock('~~/server/services/importedMtgCardResolver', () => ({
	importedMtgCardResolverService: () => ({
		resolveBatch: async () => ({
			resolutions: new Map(),
		}),
	}),
}));

vi.mock('~~/server/services/mtgCard', () => ({
	mtgCardService: () => ({
		batchUpsert: async () => new Map(),
	}),
}));

vi.mock('~~/server/utils/ably', () => ({
	publishMessage: vi.fn(),
	publishMessageStrict: vi.fn(),
}));

vi.mock('~~/server/modules/melee-sync/deckLists', () => ({
	buildPlayersWithDeckLists: () => [],
	buildResolvedCardUpserts: () => new Map(),
	collectImportedDeckCards: () => ({ cards: [], totalDeckLists: 0 }),
	createImportedCardResolver: () => () => null,
	persistPlayerDeckLists: mockPersistPlayerDeckLists,
}));

const { createMeleeSyncWorkflows } = await import('~~/server/modules/melee-sync/workflows');

const syncContext = { originConnectionId: 'origin-1' };

const eventData = {
	game: 'mtg' as const,
	meleeEnabled: true,
	meleeEventId: 'melee-1',
	meleeClientId: 'client',
	meleeClientSecret: 'secret',
	lastDecklistsSyncedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const phase = { id: 10, eventId: 1, name: 'Swiss' };
/** The tournament's one Round, not yet paired. */
const round = {
	id: 2,
	eventId: 1,
	phaseId: phase.id,
	name: 'Round 1',
	roundNumber: 1,
	externalId: '101',
	externalSource: 'melee',
	lastSyncedAt: null,
};

beforeEach(() => {
	mockMelee.fetchPlayers.mockReset().mockResolvedValue([]);
	mockMelee.fetchCurrentStandings.mockReset().mockResolvedValue([]);
	mockMelee.fetchEvent.mockReset().mockResolvedValue({
		ID: 1,
		Name: 'Event',
		Game: 'Magic: The Gathering',
		Phases: [
			{
				ID: 10,
				Name: 'Swiss',
				FormatId: 'modern',
				SortOrder: 0,
				Rounds: [
					{ ID: 101, Name: 'Round 1', SortOrder: 0 },
				],
			},
		],
	});
	mockPhaseService.findByEventId.mockReset().mockResolvedValue([]);
	mockPhaseService.findById.mockReset().mockResolvedValue(phase);
	mockPhaseService.upsertByExternalId.mockReset().mockResolvedValue({ phase, created: false });
	mockRoundService.findByEventId.mockReset().mockResolvedValue([]);
	mockRoundService.findById.mockReset().mockResolvedValue(round);
	mockRoundService.upsertByExternalId.mockReset().mockResolvedValue({ round, created: false });
	mockPlayerService.findAll.mockReset().mockResolvedValue([]);
	mockPlayerService.batchUpsertByExternalId.mockReset().mockResolvedValue({ players: [], created: 0, updated: 0 });
	mockPlayerService.reconcileMeleeSnapshot.mockReset().mockResolvedValue({
		players: [],
		created: 0,
		updated: 0,
		deactivated: 0,
	});
	mockPersistPlayerDeckLists.mockReset().mockResolvedValue({ skippedPlayers: 0, unresolvedCards: 0 });
	mockSyncMatchesFromMelee.mockReset();
});

describe('the stages a Melee Sync command reports as done when a later one throws', () => {
	it('reports structure and Players, and no Deck Lists, when Deck List persistence throws during setup', async () => {
		mockPersistPlayerDeckLists.mockRejectedValue(new Error('Deck persistence failed'));
		const progress: Array<Record<string, Date>> = [];

		await expect(
			createMeleeSyncWorkflows().runInitialSetup(
				syncContext,
				1,
				eventData,
				undefined,
				metadata => progress.push(metadata as Record<string, Date>),
			),
		).rejects.toThrow('Deck persistence failed');

		expect(progress).toEqual([
			{
				lastEventSyncedAt: expect.any(Date),
			},
			{
				lastPlayersSyncedAt: expect.any(Date),
			},
		]);
	});

	it('reports structure, Players and Deck Lists when the Round refresh after them throws during an update', async () => {
		mockRoundService.findByEventId.mockResolvedValue([round]);
		mockSyncMatchesFromMelee.mockRejectedValue(new Error('Round refresh failed'));
		const progress: Array<Record<string, Date>> = [];

		await expect(
			createMeleeSyncWorkflows().updateFromMelee(
				syncContext,
				1,
				eventData,
				{ includeDeckLists: true },
				undefined,
				metadata => progress.push(metadata as Record<string, Date>),
			),
		).rejects.toThrow('Round refresh failed');

		expect(progress).toEqual([
			{
				lastEventSyncedAt: expect.any(Date),
			},
			{
				lastPlayersSyncedAt: expect.any(Date),
			},
			{
				lastDecklistsSyncedAt: expect.any(Date),
			},
		]);
	});
});
