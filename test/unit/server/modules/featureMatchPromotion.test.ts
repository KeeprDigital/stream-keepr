import type { DbFeatureMatch, DbMatch } from '~~/server/db/schema';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockMatchService = {
	findById: vi.fn(),
};
const mockBuildMatchPromotionPlan = vi.fn();
const mockFeatureMatchService = {
	findById: vi.fn(),
};
const mockFeatureMatchAssignmentService = {
	findByRoundAndSlot: vi.fn(),
};
const mockBuildUpsertAssignmentQueries = vi.fn();
const mockFeatureMatchStateService = {
	loadEventDefaults: vi.fn(),
	buildCreateSessionForSlotQueries: vi.fn(),
};
const mockPlayerFeatureMatchSyncService = {
	syncMatchesFromPlayers: vi.fn(),
};
const mockBatch = vi.fn();
const mockPublishMessage = vi.fn();

vi.mock('hub:db', () => ({
	db: { batch: (...args: unknown[]) => mockBatch(...args) },
}));
vi.mock('~~/server/services/match', () => ({
	matchService: () => mockMatchService,
	buildMatchPromotionPlan: (...args: unknown[]) => mockBuildMatchPromotionPlan(...args),
}));
vi.mock('~~/server/services/featureMatch', () => ({
	featureMatchService: () => mockFeatureMatchService,
}));
vi.mock('~~/server/services/featureMatchAssignment', () => ({
	featureMatchAssignmentService: () => mockFeatureMatchAssignmentService,
	buildUpsertAssignmentQueries: (...args: unknown[]) => mockBuildUpsertAssignmentQueries(...args),
}));
vi.mock('~~/server/services/featureMatchState', () => ({
	featureMatchStateService: () => mockFeatureMatchStateService,
}));
vi.mock('~~/server/services/playerFeatureMatchSync', () => ({
	playerFeatureMatchSyncService: () => mockPlayerFeatureMatchSyncService,
}));
vi.mock('~~/server/utils/ably', () => ({
	publishMessage: mockPublishMessage,
}));

vi.stubGlobal('createError', (input: { statusCode: number; message?: string; statusMessage?: string }) => {
	const error = new Error(input.message ?? input.statusMessage) as Error & { statusCode: number };
	error.statusCode = input.statusCode;
	return error;
});

const { featureMatchPromotionModule } = await import('~~/server/modules/feature-match-promotion');

const NOW = new Date('2026-01-01T00:00:00.000Z');

function createMatch(overrides: Partial<DbMatch> = {}): DbMatch {
	return {
		id: 7,
		eventId: 1,
		roundId: 3,
		tableNumber: 12,
		player1Id: 101,
		player2Id: 102,
		player1Data: { name: 'Alice' },
		player2Data: { name: 'Bob' },
		player1Wins: 0,
		player2Wins: 0,
		draws: 0,
		status: 'pending',
		externalId: 'match-7',
		externalSource: 'melee',
		sortOrder: 0,
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	} as DbMatch;
}

function createFeatureMatch(overrides: Partial<DbFeatureMatch> = {}): DbFeatureMatch {
	return {
		id: 2,
		eventId: 1,
		matchId: 7,
		externalId: 'match-7',
		externalSource: 'melee',
		tableNumber: 12,
		player1Id: 101,
		player2Id: 102,
		player1Data: { name: 'Alice' },
		player2Data: { name: 'Bob' },
		bestOf: 3,
		sortOrder: 0,
		playerDisplayMode: 'score',
		activeSessionId: 55,
		roundName: 'Round 3',
		formatName: null,
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	} as DbFeatureMatch;
}

describe('feature Match Slot Promotion server module', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatureMatchStateService.loadEventDefaults.mockResolvedValue({ game: 'mtg' });
		mockFeatureMatchStateService.buildCreateSessionForSlotQueries.mockResolvedValue({ queries: ['session-q'] });
		mockBuildUpsertAssignmentQueries.mockReturnValue(['assignment-del', 'assignment-ins']);
		mockBatch.mockResolvedValue([]);
		mockPlayerFeatureMatchSyncService.syncMatchesFromPlayers.mockResolvedValue([]);
	});

	it('persists the promotion as one atomic batch, then reverse-syncs and publishes', async () => {
		const match = createMatch();
		const initialSlot = createFeatureMatch({ id: 2, matchId: null });
		const clearedFuture = createFeatureMatch({ id: 5, matchId: null });
		const promotedFuture = createFeatureMatch({ id: 2, matchId: 7 });
		const refreshedClearedSlot = createFeatureMatch({ id: 5, matchId: null, activeSessionId: 56 });
		const refreshedPromotedSlot = createFeatureMatch({ id: 2, activeSessionId: 57 });

		mockMatchService.findById.mockResolvedValue(match);
		mockFeatureMatchService.findById
			.mockResolvedValueOnce(initialSlot)
			.mockResolvedValueOnce(refreshedClearedSlot)
			.mockResolvedValueOnce(refreshedPromotedSlot);
		mockBuildMatchPromotionPlan.mockResolvedValue({
			clearedSlots: [clearedFuture],
			promotedSlot: promotedFuture,
			queries: ['clear-q', 'promote-q'],
		});
		mockFeatureMatchAssignmentService.findByRoundAndSlot.mockResolvedValue({ id: 9 });

		const result = await featureMatchPromotionModule().promoteMatchToSlot({
			eventId: 1,
			slotId: 2,
			matchId: 7,
			originConnectionId: 'origin-1',
		});

		expect(mockMatchService.findById).toHaveBeenCalledWith(7, 1);
		expect(mockFeatureMatchService.findById).toHaveBeenNthCalledWith(1, 2, 1);
		expect(mockBuildMatchPromotionPlan).toHaveBeenCalledWith(1, 2, match, initialSlot);
		expect(mockFeatureMatchStateService.buildCreateSessionForSlotQueries).toHaveBeenNthCalledWith(1, clearedFuture, 1, { game: 'mtg' });
		expect(mockFeatureMatchStateService.buildCreateSessionForSlotQueries).toHaveBeenNthCalledWith(2, promotedFuture, 1, { game: 'mtg' });
		expect(mockBuildUpsertAssignmentQueries).toHaveBeenCalledWith(1, {
			roundId: 3,
			slotId: 2,
			matchId: 7,
		});

		// Every write is composed into exactly one atomic batch, in order.
		expect(mockBatch).toHaveBeenCalledOnce();
		expect(mockBatch).toHaveBeenCalledWith([
			'clear-q',
			'promote-q',
			'session-q', // cleared slot session
			'assignment-del',
			'assignment-ins',
			'session-q', // promoted slot session
		]);

		// Reverse-sync and the Assignment re-read happen only after the batch commits.
		expect(mockPlayerFeatureMatchSyncService.syncMatchesFromPlayers).toHaveBeenCalledWith(1, [101, 102]);
		expect(mockBatch.mock.invocationCallOrder[0]).toBeLessThan(
			mockPlayerFeatureMatchSyncService.syncMatchesFromPlayers.mock.invocationCallOrder[0]!,
		);
		expect(mockFeatureMatchAssignmentService.findByRoundAndSlot).toHaveBeenCalledWith(1, 3, 2);

		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'featureMatch:updated', {
			featureMatch: expect.objectContaining({ id: 5 }),
		}, 'origin-1');
		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'featureMatch:updated', {
			featureMatch: expect.objectContaining({ id: 2, matchId: 7 }),
		}, 'origin-1');
		expect(result).toEqual({
			promotedSlot: expect.objectContaining({ id: 2, matchId: 7 }),
			clearedSlots: [expect.objectContaining({ id: 5 })],
			assignment: expect.objectContaining({ id: 9 }),
		});
	});

	it('throws 404 when the Match is not in the Event', async () => {
		mockMatchService.findById.mockResolvedValue(null);

		await expect(featureMatchPromotionModule().promoteMatchToSlot({
			eventId: 1,
			slotId: 2,
			matchId: 7,
		})).rejects.toMatchObject({ statusCode: 404, message: 'Match not found' });

		expect(mockBuildMatchPromotionPlan).not.toHaveBeenCalled();
		expect(mockBatch).not.toHaveBeenCalled();
	});

	it('throws 404 when the Feature Match Slot is not in the Event', async () => {
		mockMatchService.findById.mockResolvedValue(createMatch());
		mockFeatureMatchService.findById.mockResolvedValue(null);

		await expect(featureMatchPromotionModule().promoteMatchToSlot({
			eventId: 1,
			slotId: 2,
			matchId: 7,
		})).rejects.toMatchObject({ statusCode: 404, message: 'Feature match slot not found' });

		expect(mockBuildMatchPromotionPlan).not.toHaveBeenCalled();
		expect(mockBatch).not.toHaveBeenCalled();
	});

	it('throws 500 when the promoted Slot cannot be reloaded', async () => {
		mockMatchService.findById.mockResolvedValue(createMatch());
		mockFeatureMatchService.findById
			.mockResolvedValueOnce(createFeatureMatch({ id: 2, matchId: null }))
			.mockResolvedValueOnce(null);
		mockBuildMatchPromotionPlan.mockResolvedValue({
			clearedSlots: [],
			promotedSlot: createFeatureMatch({ id: 2, matchId: 7 }),
			queries: ['promote-q'],
		});
		mockFeatureMatchAssignmentService.findByRoundAndSlot.mockResolvedValue({ id: 9 });

		await expect(featureMatchPromotionModule().promoteMatchToSlot({
			eventId: 1,
			slotId: 2,
			matchId: 7,
		})).rejects.toMatchObject({
			statusCode: 500,
			message: 'Failed to retrieve updated feature match slot',
		});
	});
});
