import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDb, resetDbMocks } from '~~/test/helpers/db-mock';
import { createMockMatch } from '~~/test/helpers/fixtures';

vi.mock('hub:db', () => ({ db: mockDb }));
vi.mock('~~/server/db/schema', () => ({
	matches: {
		id: 'matches.id',
		eventId: 'matches.eventId',
		roundId: 'matches.roundId',
		externalId: 'matches.externalId',
		externalSource: 'matches.externalSource',
		tableNumber: 'matches.tableNumber',
		player1Id: 'matches.player1Id',
		player2Id: 'matches.player2Id',
		player1Data: 'matches.player1Data',
		player2Data: 'matches.player2Data',
		hasResult: 'matches.hasResult',
		player1GameWins: 'matches.player1GameWins',
		player2GameWins: 'matches.player2GameWins',
		gameDraws: 'matches.gameDraws',
		isBye: 'matches.isBye',
		resultString: 'matches.resultString',
		sortOrder: 'matches.sortOrder',
	},
	playerRoundStandings: {
		eventId: 'playerRoundStandings.eventId',
		playerId: 'playerRoundStandings.playerId',
		roundId: 'playerRoundStandings.roundId',
		position: 'playerRoundStandings.position',
	},
	players: {
		id: 'players.id',
		eventId: 'players.eventId',
	},
	rounds: {
		id: 'rounds.id',
		eventId: 'rounds.eventId',
		phaseId: 'rounds.phaseId',
		lastSyncedAt: 'rounds.lastSyncedAt',
	},
	phases: {
		id: 'phases.id',
		sortOrder: 'phases.sortOrder',
	},
	featureMatches: {},
}));

const { meleeRoundSnapshotService } = await import('~~/server/services/meleeRoundSnapshot');

describe('meleeRoundSnapshotService', () => {
	beforeEach(() => {
		resetDbMocks();
	});

	it('commits matches, standings, stale deletion, and sync timestamp in one batch', async () => {
		const createdAt = new Date('2026-01-01T00:00:00.000Z');
		const createdMatch = createMockMatch({
			id: 1,
			externalId: 'match-1',
			externalSource: 'melee',
			createdAt,
			updatedAt: createdAt,
		});
		const updatedMatch = createMockMatch({
			id: 2,
			externalId: 'match-2',
			externalSource: 'melee',
			createdAt,
			updatedAt: new Date('2026-01-02T00:00:00.000Z'),
		});
		mockDb.batch.mockResolvedValue([
			[{ externalId: 'match-2' }],
			[createdMatch, updatedMatch],
			[],
			[],
			[{ id: 99 }],
			[{ id: 10 }],
		]);

		const result = await meleeRoundSnapshotService().replace({
			eventId: 1,
			roundId: 10,
			matches: [
				{ eventId: 1, roundId: 10, externalId: 'match-1', externalSource: 'melee' },
				{ eventId: 1, roundId: 10, externalId: 'match-2', externalSource: 'melee' },
			],
			standings: [{
				playerId: 5,
				wins: 3,
				losses: 1,
				draws: 0,
				position: 2,
				points: 9,
			}],
		});

		expect(mockDb.batch).toHaveBeenCalledOnce();
		expect(mockDb.batch.mock.calls[0]![0]).toHaveLength(6);
		expect(result).toEqual({
			matches: [createdMatch, updatedMatch],
			created: 1,
			updated: 1,
			staleDeleted: 1,
		});
	});

	it('atomically clears stale data for an empty authoritative snapshot', async () => {
		mockDb.batch.mockResolvedValue([
			[],
			[{ id: 1 }, { id: 2 }],
			[{ id: 10 }],
		]);

		const result = await meleeRoundSnapshotService().replace({
			eventId: 1,
			roundId: 10,
			matches: [],
			standings: [],
		});

		expect(mockDb.batch).toHaveBeenCalledOnce();
		expect(mockDb.batch.mock.calls[0]![0]).toHaveLength(3);
		expect(result).toEqual({ matches: [], created: 0, updated: 0, staleDeleted: 2 });
	});

	it('surfaces a batch failure without executing a fallback partial write', async () => {
		mockDb.batch.mockRejectedValue(new Error('statement failed; transaction rolled back'));

		await expect(meleeRoundSnapshotService().replace({
			eventId: 1,
			roundId: 10,
			matches: [{ eventId: 1, roundId: 10, externalId: 'match-1', externalSource: 'melee' }],
			standings: [],
		})).rejects.toThrow('transaction rolled back');

		expect(mockDb.batch).toHaveBeenCalledOnce();
	});

	it('composes a large snapshot with bind-safe standings chunks in one atomic batch', async () => {
		const now = new Date('2026-01-01T00:00:00.000Z');
		const matchCount = 1000;
		const standingCount = 1000;
		const persistedMatches = Array.from({ length: matchCount }, (_, index) => createMockMatch({
			id: index + 1,
			externalId: `match-${index + 1}`,
			externalSource: 'melee',
			createdAt: now,
			updatedAt: now,
		}));
		mockDb.batch.mockResolvedValue([
			[],
			persistedMatches,
			[],
			[],
			[],
			[{ id: 10 }],
		]);

		const result = await meleeRoundSnapshotService().replace({
			eventId: 1,
			roundId: 10,
			matches: persistedMatches.map((match, index) => ({
				eventId: 1,
				roundId: 10,
				externalId: match.externalId!,
				externalSource: 'melee' as const,
				sortOrder: index,
			})),
			standings: Array.from({ length: standingCount }, (_, index) => ({
				playerId: index + 1,
				wins: 3,
				losses: 1,
				draws: 0,
				position: index + 1,
				points: 9,
			})),
		});

		expect(mockDb.batch).toHaveBeenCalledOnce();
		// Existing-ID read + Match upsert + standings delete/insert + stale delete + Round update.
		expect(mockDb.batch.mock.calls[0]![0]).toHaveLength(6);
		expect(result).toEqual({
			matches: persistedMatches,
			created: 1000,
			updated: 0,
			staleDeleted: 0,
		});
	});

	it('rejects duplicate Match and standing identities before persistence', async () => {
		await expect(meleeRoundSnapshotService().replace({
			eventId: 1,
			roundId: 10,
			matches: [
				{ eventId: 1, roundId: 10, externalId: 'duplicate', externalSource: 'melee' },
				{ eventId: 1, roundId: 10, externalId: 'duplicate', externalSource: 'melee' },
			],
			standings: [],
		})).rejects.toThrow('Duplicate Melee Match external identity');

		await expect(meleeRoundSnapshotService().replace({
			eventId: 1,
			roundId: 10,
			matches: [],
			standings: [
				{ playerId: 4, wins: 1, losses: 0, draws: 0, position: 1, points: 3 },
				{ playerId: 4, wins: 0, losses: 1, draws: 0, position: 2, points: 0 },
			],
		})).rejects.toThrow('Duplicate Round standing player identity');

		expect(mockDb.batch).not.toHaveBeenCalled();
	});

	it('rejects non-idempotent or out-of-scope Match rows before persistence', async () => {
		await expect(meleeRoundSnapshotService().replace({
			eventId: 1,
			roundId: 10,
			matches: [{ eventId: 1, roundId: 10 }],
			standings: [],
		})).rejects.toThrow('outside its authoritative scope');

		expect(mockDb.batch).not.toHaveBeenCalled();
	});
});
