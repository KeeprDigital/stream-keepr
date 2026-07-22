import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFeatureMatch } from '~~/test/helpers/fixtures';

const mockRepo = {
	promoteMatch: vi.fn(),
};
const mockFeatureMatchStore = {
	applyRemoteUpdated: vi.fn(),
};
const mockAssignmentStore = {
	currentEventId: 1 as number | null,
	loadedRoundId: 3 as number | null,
	applySavedAssignment: vi.fn(),
};

mockNuxtImport('useFeatureMatchRepository', () => () => mockRepo);
mockNuxtImport('useFeatureMatchStore', () => () => mockFeatureMatchStore);
mockNuxtImport('useFeatureMatchAssignmentStore', () => () => mockAssignmentStore);

describe('useFeatureMatchPromotion', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockAssignmentStore.currentEventId = 1;
		mockAssignmentStore.loadedRoundId = 3;
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
		mockAssignmentStore.loadedRoundId = 4;
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
