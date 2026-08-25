import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockEvent } from '~~/test/helpers/fixtures';

const mockRequireTalentInEvent = vi.fn();
const mockEventService = {
	findById: vi.fn(),
	update: vi.fn(),
	remove: vi.fn(),
};
const mockFeatureMatchService = {
	syncFeatureMatches: vi.fn(),
};
const mockScreenService = {
	findIdsByEventId: vi.fn(),
};
const mockCardService = {
	cleanupDeletedScreenCard: vi.fn(),
};
const mockPublication = {
	eventUpdated: vi.fn(),
	eventDeleted: vi.fn(),
};

vi.mock('~~/server/utils/routeGuards', () => ({
	requireTalentInEvent: mockRequireTalentInEvent,
}));

vi.mock('~~/server/services/event', () => ({
	eventService: () => mockEventService,
}));

vi.mock('~~/server/services/featureMatch', () => ({
	featureMatchService: () => mockFeatureMatchService,
}));

vi.mock('~~/server/services/screen', () => ({
	screenService: () => mockScreenService,
}));

vi.mock('~~/server/services/card', () => ({
	cardService: () => mockCardService,
}));

vi.mock('~~/server/modules/event-data-publication', () => ({
	eventDataPublicationModule: () => mockPublication,
}));

vi.stubGlobal('createError', (input: { statusCode: number; message?: string; statusMessage?: string }) => {
	const error = new Error(input.message ?? input.statusMessage) as Error & { statusCode: number };
	error.statusCode = input.statusCode;
	return error;
});

const { eventWriteModule } = await import('~~/server/modules/event-write');

describe('eventWriteModule', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEventService.update.mockResolvedValue(createMockEvent({ id: 1, numFeatureMatches: 2 }));
		mockEventService.findById.mockResolvedValue(createMockEvent({ id: 1, game: 'mtg' }));
		mockEventService.remove.mockResolvedValue(true);
		mockScreenService.findIdsByEventId.mockResolvedValue([{ id: 10 }, { id: 11 }]);
		mockPublication.eventUpdated.mockResolvedValue({ id: 1, name: 'Updated Event' });
		mockPublication.eventDeleted.mockResolvedValue(undefined);
	});

	describe('updateEvent', () => {
		it('refuses to enable Broadcast Deck Lists for a non-MTG Event', async () => {
			mockEventService.findById.mockResolvedValue(createMockEvent({ id: 1, game: 'op' }));

			await expect(eventWriteModule().updateEvent({
				eventId: 1,
				input: { broadcastDeckListsEnabled: true } as never,
			})).rejects.toMatchObject({
				statusCode: 400,
				message: 'Broadcast Deck Lists can only be enabled for MTG Events',
			});
			expect(mockEventService.update).not.toHaveBeenCalled();
		});
		it('validates both commentator talents before updating', async () => {
			const input = { commentator1TalentId: 3, commentator2TalentId: 4 } as never;

			await eventWriteModule().updateEvent({ eventId: 1, input, originConnectionId: 'origin-1' });

			expect(mockRequireTalentInEvent).toHaveBeenCalledWith(1, 3);
			expect(mockRequireTalentInEvent).toHaveBeenCalledWith(1, 4);
			expect(mockRequireTalentInEvent.mock.invocationCallOrder[0])
				.toBeLessThan(mockEventService.update.mock.invocationCallOrder[0]!);
		});

		it('returns 404 when the event does not exist', async () => {
			mockEventService.update.mockResolvedValue(undefined);

			await expect(eventWriteModule().updateEvent({
				eventId: 404,
				input: {} as never,
			})).rejects.toMatchObject({ statusCode: 404, message: 'Event not found' });

			expect(mockFeatureMatchService.syncFeatureMatches).not.toHaveBeenCalled();
			expect(mockPublication.eventUpdated).not.toHaveBeenCalled();
		});

		it('syncs feature matches only when numFeatureMatches is present', async () => {
			await eventWriteModule().updateEvent({
				eventId: 1,
				input: { numFeatureMatches: 2 } as never,
			});

			expect(mockFeatureMatchService.syncFeatureMatches).toHaveBeenCalledWith(1, 2);
		});

		it('does not sync feature matches when numFeatureMatches is absent', async () => {
			await eventWriteModule().updateEvent({
				eventId: 1,
				input: {} as never,
			});

			expect(mockFeatureMatchService.syncFeatureMatches).not.toHaveBeenCalled();
		});

		it('publishes the mapped event response', async () => {
			const response = await eventWriteModule().updateEvent({
				eventId: 1,
				input: {} as never,
				originConnectionId: 'origin-1',
			});

			expect(mockPublication.eventUpdated).toHaveBeenCalledWith({
				eventId: 1,
				entity: expect.objectContaining({ id: 1 }),
				originConnectionId: 'origin-1',
			});
			expect(response).toEqual({ id: 1, name: 'Updated Event' });
		});
	});

	describe('deleteEvent', () => {
		it('captures screen ids before removing the event', async () => {
			await eventWriteModule().deleteEvent({ eventId: 1 });

			expect(mockScreenService.findIdsByEventId.mock.invocationCallOrder[0])
				.toBeLessThan(mockEventService.remove.mock.invocationCallOrder[0]!);
		});

		it('returns 404 without cleanup when the event does not exist', async () => {
			mockEventService.remove.mockResolvedValue(false);

			await expect(eventWriteModule().deleteEvent({ eventId: 404 }))
				.rejects
				.toMatchObject({ statusCode: 404, message: 'Event not found' });

			expect(mockCardService.cleanupDeletedScreenCard).not.toHaveBeenCalled();
			expect(mockPublication.eventDeleted).not.toHaveBeenCalled();
		});

		it('cleans up each screen card sequentially, then publishes the deletion', async () => {
			const result = await eventWriteModule().deleteEvent({ eventId: 1, originConnectionId: 'origin-1' });

			expect(mockCardService.cleanupDeletedScreenCard).toHaveBeenNthCalledWith(1, 1, 10);
			expect(mockCardService.cleanupDeletedScreenCard).toHaveBeenNthCalledWith(2, 1, 11);
			expect(mockEventService.remove.mock.invocationCallOrder[0])
				.toBeLessThan(mockCardService.cleanupDeletedScreenCard.mock.invocationCallOrder[0]!);
			expect(mockPublication.eventDeleted).toHaveBeenCalledWith({
				eventId: 1,
				originConnectionId: 'origin-1',
			});
			expect(result).toEqual({ success: true });
		});
	});
});
