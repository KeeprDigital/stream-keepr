import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFeatureMatch } from '~~/test/helpers/fixtures';
import { transportFailure } from '~~/test/helpers/transportFailure';

const mockRepo = {
	promoteMatch: vi.fn(),
};
const mockFeatureMatchStore = {
	applyRemoteUpdated: vi.fn(),
};
const mockModalOpen = vi.fn();
const mockOverlayCreate = vi.fn(() => ({ open: mockModalOpen }));
const mockAssignmentStore = {
	currentEventId: 1 as number | null,
	assignmentsByRound: new Map<number, unknown[]>([[3, []]]),
	applySavedAssignment: vi.fn(),
};

mockNuxtImport('useFeatureMatchRepository', () => () => mockRepo);
mockNuxtImport('useFeatureMatchStore', () => () => mockFeatureMatchStore);
mockNuxtImport('useFeatureMatchAssignmentStore', () => () => mockAssignmentStore);
mockNuxtImport('useOverlay', () => () => ({ create: mockOverlayCreate }));

describe('useFeatureMatchPromotion', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRepo.promoteMatch.mockReset();
		mockAssignmentStore.currentEventId = 1;
		mockAssignmentStore.assignmentsByRound = new Map([[3, []]]);
		mockModalOpen.mockReset();
		mockOverlayCreate.mockClear();
	});

	it('shows every affected Match and Note, then retries with the reviewed Assignment versions', async () => {
		const conflictAssignments = [{
			assignment: {
				id: 9,
				eventId: 1,
				roundId: 3,
				slotId: 2,
				matchId: 8,
				note: 'Do not lose this',
				createdAt: new Date('2026-01-01T00:00:00Z'),
				updatedAt: new Date('2026-01-02T00:00:00Z'),
			},
			match: { id: 8, tableNumber: 12, player1Data: { name: 'Alice' }, player2Data: { name: 'Bob' } },
		}, {
			assignment: {
				id: 11,
				eventId: 1,
				roundId: 3,
				slotId: 4,
				matchId: 10,
				note: 'A second affected Note',
				createdAt: new Date('2026-01-01T00:00:00Z'),
				updatedAt: new Date('2026-01-03T00:00:00Z'),
			},
			match: { id: 10, tableNumber: 13, player1Data: { name: 'Carol' }, player2Data: { name: 'Dana' } },
		}];
		mockRepo.promoteMatch
			.mockRejectedValueOnce(transportFailure({
				status: 409,
				body: { data: { code: 'feature-match-note-discard-required', assignments: conflictAssignments } },
			}))
			.mockResolvedValueOnce({
				promotedSlot: createMockFeatureMatch({ id: 2, matchId: 7 }),
				clearedSlots: [],
				assignment: { ...conflictAssignments[0]!.assignment, id: 10, matchId: 7, note: null },
			});
		mockModalOpen.mockReturnValue({ result: Promise.resolve(true) });

		await useFeatureMatchPromotion().promote({ eventId: 1, roundId: 3, slotId: 2, matchId: 7 });

		expect(mockModalOpen).toHaveBeenCalledWith({ assignments: conflictAssignments });
		expect(mockRepo.promoteMatch).toHaveBeenNthCalledWith(2, 1, 2, 7, [{
			assignmentId: 9,
			updatedAt: new Date('2026-01-02T00:00:00Z'),
		}, {
			assignmentId: 11,
			updatedAt: new Date('2026-01-03T00:00:00Z'),
		}]);
	});

	it('reopens confirmation with current information after a stale retry is refused', async () => {
		const reviewed = [{
			assignment: { id: 9, updatedAt: new Date('2026-01-02T00:00:00Z'), note: 'Reviewed Note' },
			match: { id: 8, tableNumber: 12 },
		}];
		const current = [{
			assignment: { id: 9, updatedAt: new Date('2026-01-04T00:00:00Z'), note: 'Newer Note' },
			match: { id: 8, tableNumber: 12 },
		}];
		mockRepo.promoteMatch
			.mockRejectedValueOnce(transportFailure({
				status: 409,
				body: { data: { code: 'feature-match-note-discard-required', assignments: reviewed } },
			}))
			.mockRejectedValueOnce(transportFailure({
				status: 409,
				body: { data: { code: 'feature-match-note-discard-required', assignments: current } },
			}))
			.mockResolvedValueOnce({
				promotedSlot: createMockFeatureMatch({ id: 2, matchId: 7 }),
				clearedSlots: [],
				assignment: { id: 12, eventId: 1, roundId: 3, slotId: 2, matchId: 7, note: null },
			});
		mockModalOpen
			.mockReturnValueOnce({ result: Promise.resolve(true) })
			.mockReturnValueOnce({ result: Promise.resolve(true) });

		await useFeatureMatchPromotion().promote({ eventId: 1, roundId: 3, slotId: 2, matchId: 7 });

		expect(mockModalOpen).toHaveBeenNthCalledWith(1, { assignments: reviewed });
		expect(mockModalOpen).toHaveBeenNthCalledWith(2, { assignments: current });
		expect(mockRepo.promoteMatch).toHaveBeenNthCalledWith(3, 1, 2, 7, [{
			assignmentId: 9,
			updatedAt: new Date('2026-01-04T00:00:00Z'),
		}]);
	});

	it('does not retry a destructive reassignment when the user cancels confirmation', async () => {
		mockRepo.promoteMatch.mockRejectedValueOnce(transportFailure({
			status: 409,
			body: {
				data: {
					code: 'feature-match-note-discard-required',
					assignments: [{
						assignment: { id: 9, updatedAt: new Date(), note: 'Keep me' },
						match: { id: 8, tableNumber: 12 },
					}],
				},
			},
		}));
		mockModalOpen.mockReturnValue({ result: Promise.resolve(false) });

		const result = await useFeatureMatchPromotion().promote({ eventId: 1, roundId: 3, slotId: 2, matchId: 7 });

		expect(result).toBeUndefined();
		expect(mockRepo.promoteMatch).toHaveBeenCalledOnce();
	});

	it('applies promoted Slot, cleared Slots, and loaded Round Assignment', async () => {
		const promotedSlot = createMockFeatureMatch({ id: 2, matchId: 7 });
		const clearedSlot = createMockFeatureMatch({ id: 5, matchId: null });
		const assignment = {
			id: 9,
			eventId: 1,
			roundId: 3,
			slotId: 2,
			matchId: 7,
			note: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		const response = { promotedSlot, clearedSlots: [clearedSlot], assignment };
		mockRepo.promoteMatch.mockResolvedValue(response);

		const result = await useFeatureMatchPromotion().promote({
			eventId: 1,
			roundId: 3,
			slotId: 2,
			matchId: 7,
		});

		expect(mockRepo.promoteMatch).toHaveBeenCalledWith(1, 2, 7);
		expect(mockFeatureMatchStore.applyRemoteUpdated).toHaveBeenNthCalledWith(1, {
			eventId: 1,
			timestamp: expect.any(Number),
			featureMatch: clearedSlot,
		});
		expect(mockFeatureMatchStore.applyRemoteUpdated).toHaveBeenNthCalledWith(2, {
			eventId: 1,
			timestamp: expect.any(Number),
			featureMatch: promotedSlot,
		});
		expect(mockAssignmentStore.applySavedAssignment).toHaveBeenCalledWith(assignment);
		expect(result).toBe(response);
	});

	it('does not apply Assignment when another Round is loaded', async () => {
		mockAssignmentStore.assignmentsByRound = new Map([[4, []]]);
		mockRepo.promoteMatch.mockResolvedValue({
			promotedSlot: createMockFeatureMatch({ id: 2, matchId: 7 }),
			clearedSlots: [],
			assignment: { id: 9, eventId: 1, roundId: 3, slotId: 2, matchId: 7 },
		});

		await useFeatureMatchPromotion().promote({
			eventId: 1,
			roundId: 3,
			slotId: 2,
			matchId: 7,
		});

		expect(mockAssignmentStore.applySavedAssignment).not.toHaveBeenCalled();
	});
});
