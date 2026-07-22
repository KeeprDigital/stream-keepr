import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFeatureMatch } from '~~/test/helpers/fixtures';

const mockValidateFeatureMatchReferences = vi.fn();
const mockFeatureMatchService = {
	create: vi.fn(),
	remove: vi.fn(),
	update: vi.fn(),
	swapMatchOrder: vi.fn(),
};
const mockPublication = {
	featureMatchSlotCreated: vi.fn(),
	featureMatchSlotDeleted: vi.fn(),
	featureMatchSlotUpdated: vi.fn(),
	featureMatchSlotsReordered: vi.fn(),
};

vi.mock('~~/server/utils/routeGuards', () => ({
	validateFeatureMatchReferences: mockValidateFeatureMatchReferences,
}));

vi.mock('~~/server/services/featureMatch', () => ({
	featureMatchService: () => mockFeatureMatchService,
}));

vi.mock('~~/server/modules/event-data-publication', () => ({
	eventDataPublicationModule: () => mockPublication,
}));

vi.stubGlobal('createError', (input: { statusCode: number; message?: string; statusMessage?: string }) => {
	const error = new Error(input.message ?? input.statusMessage) as Error & { statusCode: number };
	error.statusCode = input.statusCode;
	return error;
});

const { featureMatchSlotWriteModule } = await import('~~/server/modules/feature-match-slot-write');

describe('featureMatchSlotWriteModule', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockValidateFeatureMatchReferences.mockResolvedValue(undefined);
		mockFeatureMatchService.create.mockResolvedValue(createMockFeatureMatch({ id: 7 }));
		mockFeatureMatchService.remove.mockResolvedValue(true);
		mockFeatureMatchService.update.mockResolvedValue(createMockFeatureMatch({ id: 7 }));
		mockFeatureMatchService.swapMatchOrder.mockResolvedValue([
			{ matchId: 7, sortOrder: 1 },
			{ matchId: 8, sortOrder: 0 },
		]);
		mockPublication.featureMatchSlotCreated.mockResolvedValue({ id: 7 });
		mockPublication.featureMatchSlotUpdated.mockResolvedValue({ id: 7 });
	});

	describe('create', () => {
		it('validates references before creating, then publishes and returns the created slot', async () => {
			const input = { tableNumber: 3, player1Id: 11, player2Id: 12 };

			const response = await featureMatchSlotWriteModule().create({
				eventId: 1,
				input,
				originConnectionId: 'origin-1',
			});

			expect(mockValidateFeatureMatchReferences).toHaveBeenCalledWith(1, input);
			expect(mockValidateFeatureMatchReferences.mock.invocationCallOrder[0])
				.toBeLessThan(mockFeatureMatchService.create.mock.invocationCallOrder[0]);
			expect(mockFeatureMatchService.create).toHaveBeenCalledWith(1, input);
			expect(mockPublication.featureMatchSlotCreated).toHaveBeenCalledWith({
				eventId: 1,
				entity: expect.objectContaining({ id: 7 }),
				originConnectionId: 'origin-1',
			});
			expect(response).toEqual({ id: 7 });
		});

		it('does not create when reference validation throws', async () => {
			mockValidateFeatureMatchReferences.mockRejectedValue(createError({ statusCode: 404, message: 'Match not found' }));

			await expect(featureMatchSlotWriteModule().create({
				eventId: 1,
				input: { matchId: 99 },
			})).rejects.toMatchObject({ statusCode: 404, message: 'Match not found' });

			expect(mockFeatureMatchService.create).not.toHaveBeenCalled();
			expect(mockPublication.featureMatchSlotCreated).not.toHaveBeenCalled();
		});
	});

	describe('remove', () => {
		it('publishes the deletion and returns success', async () => {
			const response = await featureMatchSlotWriteModule().remove({
				eventId: 1,
				slotId: 7,
				originConnectionId: 'origin-1',
			});

			expect(mockFeatureMatchService.remove).toHaveBeenCalledWith(7, 1);
			expect(mockPublication.featureMatchSlotDeleted).toHaveBeenCalledWith({
				eventId: 1,
				id: 7,
				originConnectionId: 'origin-1',
			});
			expect(response).toEqual({ success: true });
		});

		it('returns 404 and does not publish when the slot is absent', async () => {
			mockFeatureMatchService.remove.mockResolvedValue(false);

			await expect(featureMatchSlotWriteModule().remove({
				eventId: 1,
				slotId: 404,
			})).rejects.toMatchObject({
				statusCode: 404,
				message: 'Feature match slot not found',
			});

			expect(mockPublication.featureMatchSlotDeleted).not.toHaveBeenCalled();
		});
	});

	describe('updateSetup', () => {
		it('validates references before updating, then publishes and returns the updated slot', async () => {
			const input = { player1Id: 11, player2Id: 12 };

			const response = await featureMatchSlotWriteModule().updateSetup({
				eventId: 1,
				slotId: 7,
				input,
				originConnectionId: 'origin-1',
			});

			expect(mockValidateFeatureMatchReferences).toHaveBeenCalledWith(1, input);
			expect(mockValidateFeatureMatchReferences.mock.invocationCallOrder[0])
				.toBeLessThan(mockFeatureMatchService.update.mock.invocationCallOrder[0]);
			expect(mockFeatureMatchService.update).toHaveBeenCalledWith(7, 1, input);
			expect(mockPublication.featureMatchSlotUpdated).toHaveBeenCalledWith({
				eventId: 1,
				entity: expect.objectContaining({ id: 7 }),
				originConnectionId: 'origin-1',
			});
			expect(response).toEqual({ id: 7 });
		});

		it('returns 404 and does not publish when the slot is absent', async () => {
			mockFeatureMatchService.update.mockResolvedValue(undefined);

			await expect(featureMatchSlotWriteModule().updateSetup({
				eventId: 1,
				slotId: 404,
				input: {},
			})).rejects.toMatchObject({
				statusCode: 404,
				message: 'Feature match slot not found',
			});

			expect(mockPublication.featureMatchSlotUpdated).not.toHaveBeenCalled();
		});
	});

	describe('reorder', () => {
		it('swaps display order, publishes the new order, and returns the slots', async () => {
			const response = await featureMatchSlotWriteModule().reorder({
				eventId: 1,
				slotId: 7,
				direction: 'up',
				originConnectionId: 'origin-1',
			});

			expect(mockFeatureMatchService.swapMatchOrder).toHaveBeenCalledWith(1, 7, 'up');
			expect(mockPublication.featureMatchSlotsReordered).toHaveBeenCalledWith({
				eventId: 1,
				slots: [
					{ matchId: 7, sortOrder: 1 },
					{ matchId: 8, sortOrder: 0 },
				],
				originConnectionId: 'origin-1',
			});
			expect(response).toEqual({
				slots: [
					{ matchId: 7, sortOrder: 1 },
					{ matchId: 8, sortOrder: 0 },
				],
			});
		});
	});
});
