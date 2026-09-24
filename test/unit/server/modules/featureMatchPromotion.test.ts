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
	findById: vi.fn(),
	findByRoundAndSlot: vi.fn(),
	findByRoundAndMatch: vi.fn(),
};
const mockBuildUpsertAssignmentQueries = vi.fn();
const mockBuildAssignmentDisplacementGuardQuery = vi.fn();
const mockFeatureMatchStateService = {
	loadEventDefaults: vi.fn(),
	buildCreateSessionForSlotQueries: vi.fn(),
};
const mockPlayerFeatureMatchSyncService = {
	syncMatchesFromPlayers: vi.fn(),
	syncMatchesFromPlayersAfterCommit: vi.fn(),
};
const mockBatch = vi.fn();
const mockPublishMessage = vi.fn();

vi.mock('~~/server/db', () => ({
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
	buildAssignmentDisplacementGuardQuery: (...args: unknown[]) => mockBuildAssignmentDisplacementGuardQuery(...args),
	isAssignmentDisplacementGuardViolation: (error: unknown) => error instanceof Error && error.message.includes('feature_match_assignments.event_id'),
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
		mockBuildAssignmentDisplacementGuardQuery.mockReturnValue('assignment-guard');
		mockFeatureMatchAssignmentService.findByRoundAndMatch.mockResolvedValue(undefined);
		mockBatch.mockResolvedValue([]);
		mockPlayerFeatureMatchSyncService.syncMatchesFromPlayersAfterCommit.mockResolvedValue([]);
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
			'assignment-guard',
			'clear-q',
			'promote-q',
			'session-q', // cleared slot session
			'assignment-del',
			'assignment-ins',
			'session-q', // promoted slot session
		]);

		// Reverse-sync and the Assignment re-read happen only after the batch commits.
		expect(mockPlayerFeatureMatchSyncService.syncMatchesFromPlayersAfterCommit).toHaveBeenCalledWith(1, [101, 102]);
		expect(mockBatch.mock.invocationCallOrder[0]).toBeLessThan(
			mockPlayerFeatureMatchSyncService.syncMatchesFromPlayersAfterCommit.mock.invocationCallOrder[0]!,
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

	it('guards even an initially empty destination against a concurrent Note before deleting it', async () => {
		stagePromotion();
		mockFeatureMatchAssignmentService.findByRoundAndSlot
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce({ id: 9 });

		await featureMatchPromotionModule().promoteMatchToSlot({ eventId: 1, slotId: 2, matchId: 7 });

		expect(mockBuildAssignmentDisplacementGuardQuery).toHaveBeenCalledWith(1, {
			roundId: 3,
			slotId: 2,
			incomingMatchId: 7,
			expectedAssignment: undefined,
		});
		expect(mockBatch.mock.calls[0]![0][0]).toBe('assignment-guard');
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

	function stagePromotion() {
		mockMatchService.findById.mockResolvedValue(createMatch());
		mockFeatureMatchService.findById
			.mockResolvedValueOnce(createFeatureMatch({ id: 2, matchId: null }))
			.mockResolvedValue(createFeatureMatch({ id: 2, matchId: 7 }));
		mockBuildMatchPromotionPlan.mockResolvedValue({
			clearedSlots: [],
			promotedSlot: createFeatureMatch({ id: 2, matchId: 7 }),
			queries: ['promote-q'],
		});
		mockFeatureMatchAssignmentService.findByRoundAndSlot.mockResolvedValue({ id: 9 });
	}

	it('reports a lost promotion race as a conflict rather than committing it', async () => {
		stagePromotion();
		mockBatch.mockRejectedValue(new Error(
			'D1_ERROR: UNIQUE constraint failed: feature_match_slots.event_id, feature_match_slots.match_id: SQLITE_CONSTRAINT',
		));

		await expect(featureMatchPromotionModule().promoteMatchToSlot({
			eventId: 1,
			slotId: 2,
			matchId: 7,
		})).rejects.toMatchObject({ statusCode: 409 });

		expect(mockPlayerFeatureMatchSyncService.syncMatchesFromPlayersAfterCommit).not.toHaveBeenCalled();
		expect(mockPublishMessage).not.toHaveBeenCalled();
	});

	it('refuses to report another promotion as this one, when the Slot no longer holds the Match', async () => {
		mockMatchService.findById.mockResolvedValue(createMatch());
		mockFeatureMatchService.findById
			.mockResolvedValueOnce(createFeatureMatch({ id: 2, matchId: null }))
			.mockResolvedValue(createFeatureMatch({ id: 2, matchId: 9 }));
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
			statusCode: 409,
			name: 'StateConflictError',
		});

		expect(mockPublishMessage).not.toHaveBeenCalledWith(1, 'featureMatch:updated', {
			featureMatch: expect.objectContaining({ id: 2 }),
		}, undefined);
	});

	it('reverse-syncs through the post-commit form, so a lost Session race cannot fail a committed promotion', async () => {
		stagePromotion();

		await featureMatchPromotionModule().promoteMatchToSlot({ eventId: 1, slotId: 2, matchId: 7 });

		expect(mockPlayerFeatureMatchSyncService.syncMatchesFromPlayersAfterCommit).toHaveBeenCalledWith(1, [101, 102]);
		expect(mockPlayerFeatureMatchSyncService.syncMatchesFromPlayers).not.toHaveBeenCalled();
	});

	it('publishes committed Assignment changes before a fallible post-commit reverse sync', async () => {
		stagePromotion();
		mockPlayerFeatureMatchSyncService.syncMatchesFromPlayersAfterCommit.mockRejectedValue(new Error('sync failed'));

		await expect(featureMatchPromotionModule().promoteMatchToSlot({
			eventId: 1,
			slotId: 2,
			matchId: 7,
		})).rejects.toThrow('sync failed');

		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'featureMatchAssignment:created', {
			featureMatchAssignment: expect.objectContaining({ id: 9 }),
		}, undefined);
		expect(mockPublishMessage.mock.invocationCallOrder[0]).toBeLessThan(
			mockPlayerFeatureMatchSyncService.syncMatchesFromPlayersAfterCommit.mock.invocationCallOrder[0]!,
		);
	});

	it('turns a stale confirmed Assignment that was deleted into a renewed conflict', async () => {
		stagePromotion();
		mockFeatureMatchAssignmentService.findByRoundAndSlot
			.mockResolvedValueOnce({
				id: 8,
				eventId: 1,
				roundId: 3,
				slotId: 2,
				matchId: 6,
				note: 'Reviewed note',
				createdAt: NOW,
				updatedAt: NOW,
			})
			.mockResolvedValueOnce(undefined);
		mockBatch.mockRejectedValue(new Error(
			'D1_ERROR: NOT NULL constraint failed: feature_match_assignments.event_id: SQLITE_CONSTRAINT',
		));

		await expect(featureMatchPromotionModule().promoteMatchToSlot({
			eventId: 1,
			slotId: 2,
			matchId: 7,
			confirmedNoteDiscards: [{ assignmentId: 8, updatedAt: NOW }],
		})).rejects.toMatchObject({ statusCode: 409 });
	});

	it('refuses a confirmation whose reviewed Note was cleared before the retry began', async () => {
		stagePromotion();
		mockFeatureMatchAssignmentService.findByRoundAndSlot.mockResolvedValueOnce({
			id: 8,
			eventId: 1,
			roundId: 3,
			slotId: 2,
			matchId: 6,
			note: null,
			createdAt: NOW,
			updatedAt: new Date('2026-01-01T00:00:01.000Z'),
		});

		await expect(featureMatchPromotionModule().promoteMatchToSlot({
			eventId: 1,
			slotId: 2,
			matchId: 7,
			confirmedNoteDiscards: [{ assignmentId: 8, updatedAt: NOW }],
		})).rejects.toMatchObject({ statusCode: 409 });
		expect(mockBatch).not.toHaveBeenCalled();
	});
});
