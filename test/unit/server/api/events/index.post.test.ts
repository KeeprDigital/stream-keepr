import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockReadValidatedBody = vi.fn();
const mockSetResponseStatus = vi.fn();
const mockEventCreate = vi.fn();
const mockEventRemove = vi.fn();
const mockSyncFeatureMatches = vi.fn();

vi.stubGlobal('defineEventHandler', vi.fn(handler => handler));
vi.stubGlobal('readValidatedBody', mockReadValidatedBody);
vi.stubGlobal('setResponseStatus', mockSetResponseStatus);

vi.mock('~~/server/schemas/api/event', () => ({
	createEventSchema: { parse: vi.fn(input => input) },
}));

vi.mock('~~/server/mappers/event', () => ({
	mapEventToResponse: vi.fn(event => event),
}));

vi.mock('~~/server/services/event', () => ({
	eventService: () => ({
		create: mockEventCreate,
		remove: mockEventRemove,
	}),
}));

vi.mock('~~/server/services/featureMatch', () => ({
	featureMatchService: () => ({
		syncFeatureMatches: mockSyncFeatureMatches,
	}),
}));

const { default: handler } = await import('~~/server/api/events/index.post');

describe('event creation compensation', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockReadValidatedBody.mockResolvedValue({ name: 'Event' });
		mockEventCreate.mockResolvedValue({ id: 5, numFeatureMatches: 2 });
		mockEventRemove.mockResolvedValue(true);
		mockSyncFeatureMatches.mockResolvedValue({ created: [], deleted: [] });
	});

	it('compensates the created event and rethrows the original failure when slot sync fails', async () => {
		const syncFailure = new Error('sync failed');
		mockSyncFeatureMatches.mockRejectedValue(syncFailure);

		await expect(handler({} as never)).rejects.toBe(syncFailure);

		expect(mockEventRemove).toHaveBeenCalledWith(5);
	});

	it('surfaces the original failure when the compensating remove also fails, attaching the remove failure', async () => {
		const syncFailure = new Error('sync failed');
		mockSyncFeatureMatches.mockRejectedValue(syncFailure);
		const removeFailure = new Error('remove failed');
		mockEventRemove.mockRejectedValue(removeFailure);

		await expect(handler({} as never)).rejects.toBe(syncFailure);

		expect((syncFailure as { compensationFailure?: unknown }).compensationFailure).toBe(removeFailure);
	});
});
