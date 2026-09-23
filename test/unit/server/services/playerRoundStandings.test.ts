import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getChain, mockDb, resetDbMocks } from '~~/test/helpers/db-mock';

vi.mock('~~/server/db', () => ({ db: mockDb }));
vi.mock('~~/server/db/schema', () => ({
	playerRoundStandings: {
		eventId: 'playerRoundStandings.eventId',
		playerId: 'playerRoundStandings.playerId',
		roundId: 'playerRoundStandings.roundId',
		position: 'playerRoundStandings.position',
	},
}));

const { playerRoundStandingsService } = await import('~~/server/services/playerRoundStandings');

describe('playerRoundStandingsService', () => {
	beforeEach(() => {
		resetDbMocks();
	});

	describe('findByRoundId', () => {
		it('returns standings for a round', async () => {
			const standings = [
				{ id: 1, eventId: 1, playerId: 1, roundId: 1, wins: 3, losses: 0, draws: 0, position: 1, points: 9 },
			];
			getChain('select').orderBy.mockResolvedValue(standings);

			const result = await playerRoundStandingsService().findByRoundId(1, 1);

			expect(result).toEqual(standings);
		});

		it('returns empty array when no standings exist', async () => {
			getChain('select').orderBy.mockResolvedValue([]);

			const result = await playerRoundStandingsService().findByRoundId(1, 1);

			expect(result).toEqual([]);
		});
	});
});
