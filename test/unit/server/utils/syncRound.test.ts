import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockMapMeleeMatchesToDbRows = vi.fn().mockReturnValue([]);
vi.mock('~~/server/mappers/melee', async (importOriginal) => {
	const actual = await importOriginal<typeof import('~~/server/mappers/melee')>();
	return {
		...actual,
		mapMeleeMatchesToDbRows: (...args: any[]) => mockMapMeleeMatchesToDbRows(...args),
	};
});

const mockFetchMatchesByRound = vi.fn().mockResolvedValue([]);
const mockFetchStandingsByRound = vi.fn().mockResolvedValue([]);
const mockFindAll = vi.fn().mockResolvedValue([]);
const mockListDecksByEvent = vi.fn().mockResolvedValue([]);
const mockFindArchetypesByIds = vi.fn().mockResolvedValue([]);
const mockReplaceRoundSnapshot = vi.fn().mockResolvedValue({ matches: [], created: 0, updated: 0, staleDeleted: 0 });

vi.mock('~~/server/services/meleeIntegration', () => ({
	requireMeleeService: () => ({
		fetchMatchesByRound: mockFetchMatchesByRound,
		fetchStandingsByRound: mockFetchStandingsByRound,
	}),
}));
vi.mock('~~/server/services/player', () => ({
	playerService: () => ({
		findAll: mockFindAll,
	}),
}));
vi.mock('~~/server/services/playerDeck', () => ({
	playerDeckService: () => ({
		listByEvent: mockListDecksByEvent,
	}),
}));
vi.mock('~~/server/services/archetype', () => ({
	archetypeService: () => ({
		findManyByIds: mockFindArchetypesByIds,
	}),
}));
vi.mock('~~/server/services/meleeRoundSnapshot', () => ({
	meleeRoundSnapshotService: () => ({
		replace: mockReplaceRoundSnapshot,
	}),
}));

const { syncMatchesFromMelee } = await import('~~/server/modules/melee-sync/roundMatches');
const { MeleeTransportError } = await import('~~/server/services/meleeTransport');

const testRounds = [
	{ id: 10, phaseId: 1, externalId: '100', externalSource: 'melee', name: 'Round 1', roundNumber: 1, status: 'upcoming', lastSyncedAt: null, eventId: 1, createdAt: new Date(), updatedAt: new Date() },
	{ id: 20, phaseId: 1, externalId: '200', externalSource: 'melee', name: 'Round 2', roundNumber: 2, status: 'upcoming', lastSyncedAt: null, eventId: 1, createdAt: new Date(), updatedAt: new Date() },
	{ id: 30, phaseId: 2, externalId: '300', externalSource: 'melee', name: 'Quarterfinals', roundNumber: 1, status: 'upcoming', lastSyncedAt: null, eventId: 1, createdAt: new Date(), updatedAt: new Date() },
];

describe('syncMatchesFromMelee', () => {
	const eventData = {
		meleeEnabled: true,
		meleeEventId: 'evt-1',
		meleeClientId: 'client-1',
		meleeClientSecret: 'secret-1',
	};

	beforeEach(() => {
		mockFetchMatchesByRound.mockReset().mockResolvedValue([]);
		mockFetchStandingsByRound.mockReset().mockResolvedValue([]);
		mockFindAll.mockReset().mockResolvedValue([]);
		mockListDecksByEvent.mockReset().mockResolvedValue([]);
		mockFindArchetypesByIds.mockReset().mockResolvedValue([]);
		mockReplaceRoundSnapshot.mockReset().mockResolvedValue({ matches: [], created: 0, updated: 0, staleDeleted: 0 });
		mockMapMeleeMatchesToDbRows.mockReset().mockReturnValue([]);
	});

	it('provides source-safe submitted decks and reviewed archetypes to the mapper', async () => {
		const round = { ...testRounds[0], externalId: '100', externalSource: 'melee' as const, lastSyncedAt: new Date() };
		const phase = { id: 1, eventId: 1, name: 'Swiss', formatExternalId: 'standard' };
		const player = { id: 7, externalId: '42', externalSource: 'melee' };
		const deck = { id: 70, playerId: 7, externalId: 'deck-70', externalSource: 'melee', archetypeId: 5, reviewedAt: new Date(), formatExternalId: 'standard' };
		const manualDeck = { id: 71, playerId: 7, externalId: 'deck-71', externalSource: 'manual', archetypeId: 6, reviewedAt: new Date(), formatExternalId: 'standard' };
		const archetype = { id: 5, name: 'Control', colors: 'WU' };
		mockFindAll.mockResolvedValue([player]);
		mockListDecksByEvent.mockResolvedValue([manualDeck, deck]);
		mockFindArchetypesByIds.mockResolvedValue([archetype]);

		await syncMatchesFromMelee(1, eventData, round as any, phase as any);

		expect(mockFindArchetypesByIds).toHaveBeenCalledWith(1, [5]);
		expect(mockMapMeleeMatchesToDbRows).toHaveBeenCalledWith([], 10, 1, expect.objectContaining({
			playerDecksByPlayerId: new Map([[7, [deck]]]),
			archetypesById: new Map([[5, archetype]]),
			roundFormatExternalId: 'standard',
			warnings: [],
		}));
	});

	it('allows an empty authoritative refresh for a previously synced Round', async () => {
		const round = { ...testRounds[0], externalId: '100', externalSource: 'melee' as const, lastSyncedAt: new Date() };

		const result = await syncMatchesFromMelee(1, eventData, round as any, null);

		expect(result.success).toBe(true);
		expect(result.round.id).toBe(10);
		expect(result.matchCount).toBe(0);
		expect(mockReplaceRoundSnapshot).toHaveBeenCalledWith({
			eventId: 1,
			roundId: 10,
			matches: [],
			standings: [],
		});
	});

	it('maps standings through the Melee source identity when another source has the same ID', async () => {
		const round = { ...testRounds[0], externalId: '100', externalSource: 'melee' as const };
		mockFindAll.mockResolvedValue([
			{ id: 6, externalId: '42', externalSource: 'manual' },
			{ id: 7, externalId: '42', externalSource: 'melee' },
		]);
		mockFetchStandingsByRound.mockResolvedValue([
			{ TeamId: 42, MatchWins: 4, MatchLosses: 1, MatchDraws: 0, Rank: 3, Points: 12 },
		]);

		await syncMatchesFromMelee(1, eventData, round as any, null);

		expect(mockReplaceRoundSnapshot).toHaveBeenCalledWith(expect.objectContaining({
			standings: [{
				playerId: 7,
				wins: 4,
				losses: 1,
				draws: 0,
				position: 3,
				points: 12,
			}],
		}));
		expect(mockMapMeleeMatchesToDbRows).toHaveBeenCalledWith([], 10, 1, expect.objectContaining({
			playerMap: expect.objectContaining({
				get: expect.any(Function),
			}),
		}));
		const mapperContext = mockMapMeleeMatchesToDbRows.mock.calls[0]![3];
		expect(mapperContext.playerMap.get('melee\u000042')).toMatchObject({ id: 7 });
		expect(mapperContext.playerMap.get('manual\u000042')).toMatchObject({ id: 6 });
	});

	it('rejects unknown or duplicate standing participants before replacement', async () => {
		const round = { ...testRounds[0], externalId: '100', externalSource: 'melee' as const };
		mockFindAll.mockResolvedValue([{ id: 7, externalId: '42', externalSource: 'melee' }]);
		mockFetchStandingsByRound.mockResolvedValue([
			{ TeamId: 99, MatchWins: 1, MatchLosses: 0, MatchDraws: 0, Rank: 1, Points: 3 },
		]);

		await expect(syncMatchesFromMelee(1, eventData, round as any, null)).rejects.toThrow('unknown Melee participant 99');
		expect(mockReplaceRoundSnapshot).not.toHaveBeenCalled();

		mockFetchStandingsByRound.mockResolvedValue([
			{ TeamId: 42, MatchWins: 1, MatchLosses: 0, MatchDraws: 0, Rank: 1, Points: 3 },
			{ TeamId: 42, MatchWins: 1, MatchLosses: 0, MatchDraws: 0, Rank: 1, Points: 3 },
		]);

		await expect(syncMatchesFromMelee(1, eventData, round as any, null)).rejects.toThrow('Duplicate Melee Round standing participant 42');
		expect(mockReplaceRoundSnapshot).not.toHaveBeenCalled();
	});

	it('does not replace or mark a new unpaired empty Round as synced', async () => {
		const round = { ...testRounds[1], externalId: '200', externalSource: 'melee' as const, lastSyncedAt: null };

		await expect(syncMatchesFromMelee(1, eventData, round as any, null)).rejects.toMatchObject({
			code: 'MELEE_ROUND_NOT_READY',
			statusCode: 409,
		});
		expect(mockMapMeleeMatchesToDbRows).not.toHaveBeenCalled();
		expect(mockReplaceRoundSnapshot).not.toHaveBeenCalled();
	});

	// Melee.gg returns 404 from the round match and standing list endpoints when
	// a round exists but has not been paired ("round does not exist or has no
	// standings" per the published API spec).
	it('treats a Melee 404 for a never-synced Round as not ready', async () => {
		const round = { ...testRounds[1], externalId: '200', externalSource: 'melee' as const, lastSyncedAt: null };
		const notFound = new MeleeTransportError('Melee.gg API request failed with status 404', 'http', 404);
		mockFetchMatchesByRound.mockRejectedValue(notFound);
		mockFetchStandingsByRound.mockRejectedValue(notFound);

		await expect(syncMatchesFromMelee(1, eventData, round as any, null)).rejects.toMatchObject({
			code: 'MELEE_ROUND_NOT_READY',
			statusCode: 409,
		});
		expect(mockReplaceRoundSnapshot).not.toHaveBeenCalled();
	});

	it('propagates a Melee 404 for a previously synced Round instead of wiping it', async () => {
		const round = { ...testRounds[0], externalId: '100', externalSource: 'melee' as const, lastSyncedAt: new Date() };
		const notFound = new MeleeTransportError('Melee.gg API request failed with status 404', 'http', 404);
		mockFetchMatchesByRound.mockRejectedValue(notFound);
		mockFetchStandingsByRound.mockRejectedValue(notFound);

		await expect(syncMatchesFromMelee(1, eventData, round as any, null)).rejects.toMatchObject({
			code: 'MELEE_UPSTREAM_FAILURE',
		});
		expect(mockReplaceRoundSnapshot).not.toHaveBeenCalled();
	});

	it('propagates non-404 Melee failures for a never-synced Round', async () => {
		const round = { ...testRounds[1], externalId: '200', externalSource: 'melee' as const, lastSyncedAt: null };
		mockFetchMatchesByRound.mockRejectedValue(
			new MeleeTransportError('Melee.gg API request failed with status 503', 'http', 503),
		);

		await expect(syncMatchesFromMelee(1, eventData, round as any, null)).rejects.toMatchObject({
			code: 'MELEE_UPSTREAM_FAILURE',
		});
		expect(mockReplaceRoundSnapshot).not.toHaveBeenCalled();
	});

	it('includes phase name in result message when provided', async () => {
		const round = { ...testRounds[0], externalId: '100', externalSource: 'melee' as const, lastSyncedAt: new Date() };
		const phase = { id: 1, name: 'Swiss', eventId: 1, sortOrder: 0, externalId: null, externalSource: null, createdAt: new Date(), updatedAt: new Date() };

		const result = await syncMatchesFromMelee(1, eventData, round as any, phase as any);

		expect(result.message).toContain('Swiss');
	});

	it('counts created and updated matches', async () => {
		const round = { ...testRounds[0], externalId: '100', externalSource: 'melee' as const };
		mockFetchMatchesByRound.mockResolvedValue([
			{ Guid: 'match-1', TableNumber: 1, Competitors: [], HasResult: false, ByeReason: null, GameDraws: 0 },
			{ Guid: 'match-2', TableNumber: 2, Competitors: [], HasResult: false, ByeReason: null, GameDraws: 0 },
		]);

		// Mock the mapper to return DB-ready rows
		mockMapMeleeMatchesToDbRows.mockReturnValue([
			{ eventId: 1, roundId: 10, externalId: 'match-1', externalSource: 'melee', sortOrder: 0 },
			{ eventId: 1, roundId: 10, externalId: 'match-2', externalSource: 'melee', sortOrder: 1 },
		]);

		mockReplaceRoundSnapshot.mockResolvedValue({ matches: [{}, {}], created: 1, updated: 1, staleDeleted: 0 });

		const result = await syncMatchesFromMelee(1, eventData, round as any, null);

		expect(result.matchCount).toBe(2);
		expect(result.created).toBe(1);
		expect(result.updated).toBe(1);
	});

	it('does not report success when atomic persistence fails', async () => {
		const round = { ...testRounds[0], externalId: '100', externalSource: 'melee' as const, lastSyncedAt: new Date() };
		mockReplaceRoundSnapshot.mockRejectedValue(new Error('batch rolled back'));

		await expect(syncMatchesFromMelee(1, eventData, round as any, null)).rejects.toThrow('batch rolled back');
	});
});
