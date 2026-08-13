import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getChain, mockDb, resetDbMocks } from '~~/test/helpers/db-mock';
import { createMockPlayer } from '~~/test/helpers/fixtures';

vi.mock('hub:db', () => ({ db: mockDb }));
const mockListDecksByPlayer = vi.fn();
const mockFindArchetypesByIds = vi.fn();
const mockFeatureMatchStateService = {
	loadEventDefaults: vi.fn(),
	buildSourceSnapshot: vi.fn(),
	applyCommandToActiveSession: vi.fn(),
};
vi.mock('~~/server/services/playerDeck', () => ({
	playerDeckService: () => ({ listByPlayer: mockListDecksByPlayer }),
}));
vi.mock('~~/server/services/archetype', () => ({
	archetypeService: () => ({ findManyByIds: mockFindArchetypesByIds }),
}));
vi.mock('~~/server/services/featureMatchState', () => ({
	featureMatchStateService: () => mockFeatureMatchStateService,
}));
vi.mock('~~/server/db/schema', () => ({
	players: {
		id: 'players.id',
		eventId: 'players.eventId',
		externalId: 'players.externalId',
		externalSource: 'players.externalSource',
	},
	featureMatches: {
		id: 'featureMatches.id',
		eventId: 'featureMatches.eventId',
		externalId: 'featureMatches.externalId',
		externalSource: 'featureMatches.externalSource',
		tableNumber: 'featureMatches.tableNumber',
		roundName: 'featureMatches.roundName',
		formatName: 'featureMatches.formatName',
		player1Id: 'featureMatches.player1Id',
		player2Id: 'featureMatches.player2Id',
		player1Data: 'featureMatches.player1Data',
		player2Data: 'featureMatches.player2Data',
		matchId: 'featureMatches.matchId',
		bestOf: 'featureMatches.bestOf',
		sortOrder: 'featureMatches.sortOrder',
		playerDisplayMode: 'featureMatches.playerDisplayMode',
		activeSessionId: 'featureMatches.activeSessionId',
		createdAt: 'featureMatches.createdAt',
		updatedAt: 'featureMatches.updatedAt',
	},
	matches: {
		id: 'matches.id',
		eventId: 'matches.eventId',
		roundId: 'matches.roundId',
	},
	rounds: {
		id: 'rounds.id',
		phaseId: 'rounds.phaseId',
	},
	phases: {
		id: 'phases.id',
		formatExternalId: 'phases.formatExternalId',
	},
	playerDecks: {
		id: 'playerDecks.id',
		eventId: 'playerDecks.eventId',
		playerId: 'playerDecks.playerId',
		isPrimary: 'playerDecks.isPrimary',
		sortOrder: 'playerDecks.sortOrder',
	},
	archetypes: {
		id: 'archetypes.id',
		eventId: 'archetypes.eventId',
		name: 'archetypes.name',
		colors: 'archetypes.colors',
	},
}));

const { playerFeatureMatchSyncService } = await import('~~/server/services/playerFeatureMatchSync');

function mockRefreshReads(options: {
	matches: any[];
	players?: any[];
	decks?: any[];
	archetypes?: any[];
}) {
	const chain = getChain('select');
	chain.where.mockResolvedValueOnce(options.matches);
	if (options.matches.length === 0)
		return;
	chain.where.mockResolvedValueOnce(options.players ?? []);
	if ((options.players ?? []).length === 0)
		return;
	chain.where.mockReturnValueOnce(chain);
	chain.orderBy.mockResolvedValueOnce(options.decks ?? []);
	if ((options.decks ?? []).some(deck => deck.reviewedAt != null && deck.archetypeId != null))
		chain.where.mockResolvedValueOnce(options.archetypes ?? []);
}

describe('playerFeatureMatchSyncService', () => {
	beforeEach(() => {
		resetDbMocks();
		mockListDecksByPlayer.mockReset().mockResolvedValue([]);
		mockFindArchetypesByIds.mockReset().mockResolvedValue([]);
		mockFeatureMatchStateService.loadEventDefaults.mockReset().mockResolvedValue(undefined);
		mockFeatureMatchStateService.buildSourceSnapshot.mockReset().mockResolvedValue({});
		mockFeatureMatchStateService.applyCommandToActiveSession.mockReset().mockResolvedValue(null);
	});

	describe('syncMatchesFromPlayers (single player)', () => {
		it('finds affected feature matches and updates player data snapshots', async () => {
			const player = createMockPlayer({ id: 5, name: 'Updated Name' });
			mockRefreshReads({
				matches: [
					{ id: 1, eventId: 1, player1Id: 5, player2Id: 10 },
					{ id: 2, eventId: 1, player1Id: 20, player2Id: 5 },
				],
				players: [player],
			});

			const result = await playerFeatureMatchSyncService().syncMatchesFromPlayers(1, [5]);

			expect(result).toEqual([1, 2]);
			expect(mockDb.update).toHaveBeenCalledOnce();
			expect(mockDb.batch).toHaveBeenCalledOnce();
		});

		it('returns empty when player not found', async () => {
			mockRefreshReads({
				matches: [{ id: 1, eventId: 1, player1Id: 999, player2Id: null }],
				players: [],
			});

			const result = await playerFeatureMatchSyncService().syncMatchesFromPlayers(1, [999]);

			expect(result).toEqual([]);
		});

		it('returns empty when no matches reference the player', async () => {
			mockRefreshReads({ matches: [] });

			const result = await playerFeatureMatchSyncService().syncMatchesFromPlayers(1, [1]);

			expect(result).toEqual([]);
		});

		it('uses the reviewed deck matching the feature match phase format', async () => {
			const reviewedAt = new Date('2026-07-15T00:00:00.000Z');
			const player = createMockPlayer({
				id: 5,
				gameData: { type: 'mtg', deckName: 'Primary Import', deckColors: 'R' },
			});
			mockRefreshReads({
				matches: [{ id: 1, eventId: 1, player1Id: 5, player2Id: 10, formatExternalId: 'standard' }],
				players: [player],
				decks: [
					{ id: 10, playerId: 5, formatExternalId: 'modern', name: 'Primary Import', colors: 'R', isPrimary: true, sortOrder: 0, archetypeId: null, reviewedAt: null },
					{ id: 20, playerId: 5, formatExternalId: 'standard', name: 'Secondary Import', colors: 'U', isPrimary: false, sortOrder: 1, archetypeId: 7, reviewedAt },
				],
				archetypes: [{ id: 7, name: 'Reviewed Control', colors: 'WU' }],
			});

			await playerFeatureMatchSyncService().syncMatchesFromPlayers(1, [5]);

			expect(mockFeatureMatchStateService.buildSourceSnapshot.mock.calls[0]![0]).toEqual(expect.objectContaining({
				player1Data: expect.objectContaining({
					archetypeId: 7,
					gameData: expect.objectContaining({
						deckName: 'Reviewed Control',
						deckColors: 'WU',
					}),
				}),
			}));
		});

		it('preserves the exact submitted deck identity across promotion refreshes', async () => {
			const player = createMockPlayer({
				id: 5,
				gameData: { type: 'mtg', deckName: 'Primary Import', deckColors: 'R' },
			});
			mockRefreshReads({
				matches: [{
					id: 1,
					eventId: 1,
					player1Id: 5,
					player2Id: 10,
					player1Data: { name: 'Alice', deckId: 30 },
					player2Data: null,
					formatExternalId: 'standard',
				}],
				players: [player],
				decks: [
					{ id: 20, playerId: 5, formatExternalId: 'standard', name: 'First Standard', colors: 'U', sortOrder: 0, isPrimary: false, archetypeId: null, reviewedAt: null },
					{ id: 30, playerId: 5, formatExternalId: 'standard', name: 'Exact Standard', colors: 'G', sortOrder: 1, isPrimary: false, archetypeId: null, reviewedAt: null },
					{ id: 10, playerId: 5, formatExternalId: 'modern', name: 'Primary Import', colors: 'R', sortOrder: 0, isPrimary: true, archetypeId: null, reviewedAt: null },
				],
			});

			await playerFeatureMatchSyncService().syncMatchesFromPlayers(1, [5]);

			expect(mockFeatureMatchStateService.buildSourceSnapshot.mock.calls[0]![0]).toEqual(expect.objectContaining({
				player1Data: expect.objectContaining({
					deckId: 30,
					gameData: expect.objectContaining({
						deckName: 'Exact Standard',
						deckColors: 'G',
					}),
				}),
			}));
		});

		it('does not replace an explicit no-deck match snapshot with a format deck', async () => {
			const player = createMockPlayer({
				id: 5,
				gameData: { type: 'mtg', deckName: 'Primary Import', deckColors: 'R' },
			});
			mockRefreshReads({
				matches: [{
					id: 1,
					eventId: 1,
					player1Id: 5,
					player2Id: null,
					player1Data: {
						name: 'Alice',
						deckId: null,
						archetypeId: null,
						gameData: { type: 'mtg', deckName: null, deckColors: null },
					},
					formatExternalId: 'standard',
				}],
				players: [player],
				decks: [
					{ id: 20, playerId: 5, formatExternalId: 'standard', name: 'Standard Deck', colors: 'U', sortOrder: 0, isPrimary: false, archetypeId: null, reviewedAt: null },
				],
			});

			await playerFeatureMatchSyncService().syncMatchesFromPlayers(1, [5]);

			expect(mockFeatureMatchStateService.buildSourceSnapshot.mock.calls[0]![0]).toEqual(expect.objectContaining({
				player1Data: expect.objectContaining({
					deckId: null,
					archetypeId: null,
					gameData: { type: 'mtg', deckName: null, deckColors: null },
				}),
			}));
		});

		it('preserves an exact historical deck snapshot after that deck leaves the current import', async () => {
			const historicalGameData = { type: 'mtg' as const, deckName: 'Historical Deck', deckColors: 'G' };
			const player = createMockPlayer({
				id: 5,
				gameData: { type: 'mtg', deckName: 'Current Primary', deckColors: 'R' },
			});
			mockRefreshReads({
				matches: [{
					id: 1,
					eventId: 1,
					player1Id: 5,
					player2Id: null,
					player1Data: {
						name: 'Alice',
						deckId: 99,
						archetypeId: 8,
						gameData: historicalGameData,
					},
					formatExternalId: 'standard',
				}],
				players: [player],
				decks: [
					{ id: 20, playerId: 5, formatExternalId: 'standard', name: 'New Standard', colors: 'U', sortOrder: 0, isPrimary: false, archetypeId: null, reviewedAt: null },
				],
			});

			await playerFeatureMatchSyncService().syncMatchesFromPlayers(1, [5]);

			expect(mockFeatureMatchStateService.buildSourceSnapshot.mock.calls[0]![0]).toEqual(expect.objectContaining({
				player1Data: expect.objectContaining({
					deckId: 99,
					archetypeId: 8,
					gameData: historicalGameData,
				}),
			}));
		});
	});

	describe('syncMatchesFromPlayers', () => {
		it('returns empty array for empty input', async () => {
			const result = await playerFeatureMatchSyncService().syncMatchesFromPlayers(1, []);

			expect(result).toEqual([]);
		});

		it('deduplicates player IDs and returns unique match IDs', async () => {
			const player1 = createMockPlayer({ id: 1 });
			const player2 = createMockPlayer({ id: 2 });
			mockRefreshReads({
				matches: [{ id: 1, eventId: 1, player1Id: 1, player2Id: 2 }],
				players: [player1, player2],
			});

			const result = await playerFeatureMatchSyncService().syncMatchesFromPlayers(1, [1, 2, 1]);

			const unique = [...new Set(result)];
			expect(unique.length).toBe(result.length);
		});

		it('corrects active session snapshots after updating stored player data', async () => {
			const sourceSnapshot = { eventId: 1, slotId: 1 };
			mockRefreshReads({
				matches: [{ id: 1, eventId: 1, player1Id: 1, player2Id: 2 }],
				players: [createMockPlayer({ id: 1 })],
			});
			mockFeatureMatchStateService.buildSourceSnapshot.mockResolvedValue(sourceSnapshot);

			await playerFeatureMatchSyncService().syncMatchesFromPlayers(1, [1]);

			expect(mockFeatureMatchStateService.applyCommandToActiveSession).toHaveBeenCalledWith(
				1,
				1,
				expect.any(Function),
			);
			const createCommand = mockFeatureMatchStateService.applyCommandToActiveSession.mock.calls[0]![2];
			expect(createCommand({ sequence: 4 })).toMatchObject({
				type: 'SnapshotCorrected',
				payload: { sourceSnapshot },
				baseSequence: 4,
			});
		});

		describe('as a post-commit follow-on', () => {
			it('absorbs a lost Session race and says so, leaving the delta for the next pass', async () => {
				const conflict = new Error('Feature match session has advanced') as Error & { statusCode: number };
				conflict.statusCode = 409;
				mockRefreshReads({
					matches: [{ id: 1, eventId: 1, player1Id: 1, player2Id: null }],
					players: [createMockPlayer({ id: 1, name: 'Renamed Player' })],
				});
				mockFeatureMatchStateService.applyCommandToActiveSession.mockRejectedValueOnce(conflict);
				const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

				await expect(
					playerFeatureMatchSyncService().syncMatchesFromPlayersAfterCommit(1, [1]),
				).resolves.toEqual([]);

				expect(logged).toHaveBeenCalledWith(expect.stringContaining('feature_match_reverse_sync_conflict'));
				expect(mockDb.batch).not.toHaveBeenCalled();
				logged.mockRestore();
			});

			it('still fails on a fault, which is not a race the caller may absorb', async () => {
				mockRefreshReads({
					matches: [{ id: 1, eventId: 1, player1Id: 1, player2Id: null }],
					players: [createMockPlayer({ id: 1, name: 'Renamed Player' })],
				});
				mockFeatureMatchStateService.applyCommandToActiveSession
					.mockRejectedValueOnce(new Error('D1_ERROR: no such table: feature_match_sessions'));

				await expect(
					playerFeatureMatchSyncService().syncMatchesFromPlayersAfterCommit(1, [1]),
				).rejects.toThrow('no such table');
			});
		});

		it('leaves slot snapshots retryable when active-session correction fails', async () => {
			const readOptions = {
				matches: [{ id: 1, eventId: 1, player1Id: 1, player2Id: null }],
				players: [createMockPlayer({ id: 1, name: 'Updated Player' })],
			};
			mockRefreshReads(readOptions);
			mockFeatureMatchStateService.applyCommandToActiveSession.mockRejectedValueOnce(new Error('session CAS failed'));

			await expect(
				playerFeatureMatchSyncService().syncMatchesFromPlayers(1, [1]),
			).rejects.toThrow('session CAS failed');
			expect(mockDb.batch).not.toHaveBeenCalled();

			mockRefreshReads(readOptions);
			mockFeatureMatchStateService.applyCommandToActiveSession.mockResolvedValueOnce(null);
			await expect(
				playerFeatureMatchSyncService().syncMatchesFromPlayers(1, [1]),
			).resolves.toEqual([1]);
			expect(mockDb.batch).toHaveBeenCalledOnce();
		});

		it('does only one lookup for one thousand players when no feature slot references them', async () => {
			mockRefreshReads({ matches: [] });

			const result = await playerFeatureMatchSyncService().syncMatchesFromPlayers(
				1,
				Array.from({ length: 1000 }, (_, index) => index + 1),
			);

			expect(result).toEqual([]);
			expect(mockDb.select).toHaveBeenCalledOnce();
			expect(mockDb.update).not.toHaveBeenCalled();
			expect(mockFeatureMatchStateService.applyCommandToActiveSession).not.toHaveBeenCalled();
		});

		it('does not churn a slot or active session when the embedded snapshot is unchanged', async () => {
			const player = createMockPlayer({ id: 1 });
			const player1Data = {
				name: player.name,
				pronouns: player.pronouns,
				externalId: player.externalId,
				externalSource: player.externalSource,
				wins: player.wins,
				losses: player.losses,
				draws: player.draws,
				position: player.position,
				points: player.points,
				archetypeId: player.archetypeId,
				lgs: player.lgs,
				gameData: player.gameData,
				deckId: null,
			};
			mockRefreshReads({
				matches: [{ id: 1, eventId: 1, player1Id: 1, player2Id: null, player1Data }],
				players: [player],
			});

			const result = await playerFeatureMatchSyncService().syncMatchesFromPlayers(1, [1]);

			expect(result).toEqual([]);
			expect(mockDb.update).not.toHaveBeenCalled();
			expect(mockDb.batch).not.toHaveBeenCalled();
			expect(mockFeatureMatchStateService.applyCommandToActiveSession).not.toHaveBeenCalled();
		});
	});
});
