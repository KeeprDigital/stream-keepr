import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetValidatedRouterParams = vi.fn();
const mockGetOriginConnectionId = vi.fn();
const mockFindArchetypeById = vi.fn();
const mockBuildRemoveQuery = vi.fn();
const mockListPlayerIdsByArchetype = vi.fn();
const mockListPrimaryPlayerIdsByArchetype = vi.fn();
const mockBuildClearReviewsByArchetypeQuery = vi.fn();
const mockReconcileDeckProjections = vi.fn();
const mockPublishPlayerSnapshotUpdates = vi.fn();
const mockArchetypeDeleted = vi.fn();
const mockDbBatch = vi.fn();

vi.stubGlobal('defineEventHandler', vi.fn(handler => handler));
vi.stubGlobal('getValidatedRouterParams', mockGetValidatedRouterParams);
vi.stubGlobal('createError', (input: { statusCode?: number; statusMessage?: string; message?: string }) =>
	Object.assign(new Error(input.message ?? input.statusMessage), input));

vi.mock('hub:db', () => ({
	db: { batch: mockDbBatch },
}));

vi.mock('~~/server/schemas/api/archetype', () => ({
	archetypeParamsSchema: { parse: vi.fn(input => input) },
}));

vi.mock('~~/server/services/archetype', () => ({
	archetypeService: () => ({
		findById: mockFindArchetypeById,
		buildRemoveQuery: mockBuildRemoveQuery,
	}),
}));

vi.mock('~~/server/services/playerDeck', () => ({
	playerDeckService: () => ({
		listPlayerIdsByArchetype: mockListPlayerIdsByArchetype,
		listPrimaryPlayerIdsByArchetype: mockListPrimaryPlayerIdsByArchetype,
		buildClearReviewsByArchetypeQuery: mockBuildClearReviewsByArchetypeQuery,
	}),
}));

vi.mock('~~/server/modules/player-update', () => ({
	playerUpdateModule: () => ({
		reconcileDeckProjections: mockReconcileDeckProjections,
		publishPlayerSnapshotUpdates: mockPublishPlayerSnapshotUpdates,
	}),
}));

vi.mock('~~/server/modules/event-data-publication', () => ({
	eventDataPublicationModule: () => ({
		archetypeDeleted: mockArchetypeDeleted,
	}),
}));

vi.mock('~~/server/utils/ably', () => ({
	getOriginConnectionId: mockGetOriginConnectionId,
}));

const { default: handler } = await import('~~/server/api/events/[id]/archetypes/[archetypeId]/index.delete');

describe('delete /api/events/[id]/archetypes/[archetypeId]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetValidatedRouterParams.mockResolvedValue({ id: 1, archetypeId: 11 });
		mockGetOriginConnectionId.mockReturnValue('origin-1');
		mockFindArchetypeById.mockResolvedValue({ id: 11, eventId: 1 });
		mockListPlayerIdsByArchetype.mockResolvedValue([2, 3]);
		mockListPrimaryPlayerIdsByArchetype.mockResolvedValue([2]);
		mockBuildClearReviewsByArchetypeQuery.mockReturnValue('clear-query');
		mockBuildRemoveQuery.mockReturnValue('remove-query');
		mockDbBatch.mockResolvedValue([{}, [{ id: 11 }]]);
		mockReconcileDeckProjections.mockResolvedValue([]);
		mockPublishPlayerSnapshotUpdates.mockResolvedValue([]);
		mockArchetypeDeleted.mockResolvedValue(undefined);
	});

	it('clears deck reviews and deletes the archetype in a single atomic batch', async () => {
		await handler({} as any);

		expect(mockDbBatch).toHaveBeenCalledTimes(1);
		expect(mockDbBatch).toHaveBeenCalledWith(['clear-query', 'remove-query']);
		expect(mockBuildClearReviewsByArchetypeQuery).toHaveBeenCalledWith(1, 11);
		expect(mockBuildRemoveQuery).toHaveBeenCalledWith(11, 1);
	});

	it('reconciles primary players and publishes secondary player snapshot updates', async () => {
		await handler({} as any);

		expect(mockReconcileDeckProjections).toHaveBeenCalledWith({
			eventId: 1,
			playerIds: [2],
			originConnectionId: 'origin-1',
		});
		expect(mockPublishPlayerSnapshotUpdates).toHaveBeenCalledWith({
			eventId: 1,
			playerIds: [3],
			originConnectionId: 'origin-1',
		});
		expect(mockArchetypeDeleted).toHaveBeenCalledWith({
			eventId: 1,
			id: 11,
			originConnectionId: 'origin-1',
		});
	});

	it('returns 404 without reconciling when the delete branch of the batch found nothing', async () => {
		mockDbBatch.mockResolvedValue([{}, []]);

		await expect(handler({} as any)).rejects.toMatchObject({ statusCode: 404 });
		expect(mockReconcileDeckProjections).not.toHaveBeenCalled();
		expect(mockArchetypeDeleted).not.toHaveBeenCalled();
	});

	it('returns 404 up front and skips the batch when the archetype is not found', async () => {
		mockFindArchetypeById.mockResolvedValue(undefined);

		await expect(handler({} as any)).rejects.toMatchObject({ statusCode: 404 });
		expect(mockDbBatch).not.toHaveBeenCalled();
	});

	it('returns success:true on completion', async () => {
		const result = await handler({} as any);
		expect(result).toEqual({ success: true });
	});
});
