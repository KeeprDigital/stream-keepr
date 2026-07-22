import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockPlayerList } from '~~/test/helpers/fixtures';

const mockPlayerListService = {
	create: vi.fn(),
	update: vi.fn(),
	remove: vi.fn(),
	addMembers: vi.fn(),
	removeMember: vi.fn(),
	batchRemoveMembers: vi.fn(),
	reorderMembers: vi.fn(),
	getMemberCount: vi.fn(),
};
const mockPublication = {
	playerListCreated: vi.fn(),
	playerListUpdated: vi.fn(),
	playerListDeleted: vi.fn(),
	playerListMembersChanged: vi.fn(),
};

vi.mock('~~/server/services/playerList', () => ({
	playerListService: () => mockPlayerListService,
}));

vi.mock('~~/server/modules/event-data-publication', () => ({
	eventDataPublicationModule: () => mockPublication,
}));

vi.stubGlobal('createError', (input: { statusCode: number; message?: string; statusMessage?: string }) => {
	const error = new Error(input.message ?? input.statusMessage) as Error & { statusCode: number };
	error.statusCode = input.statusCode;
	return error;
});

const { playerListWriteModule } = await import('~~/server/modules/player-list-write');

describe('playerListWriteModule', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockPlayerListService.create.mockResolvedValue(createMockPlayerList({ id: 7, name: 'New List' }));
		mockPlayerListService.update.mockResolvedValue(createMockPlayerList({ id: 7, name: 'Renamed List' }));
		mockPlayerListService.remove.mockResolvedValue(true);
		mockPlayerListService.addMembers.mockResolvedValue({ added: 2 });
		mockPlayerListService.removeMember.mockResolvedValue(true);
		mockPlayerListService.batchRemoveMembers.mockResolvedValue(3);
		mockPlayerListService.reorderMembers.mockResolvedValue({ reordered: 4 });
		mockPlayerListService.getMemberCount.mockResolvedValue(5);
		mockPublication.playerListCreated.mockResolvedValue({ id: 7, name: 'New List' });
		mockPublication.playerListUpdated.mockResolvedValue({ id: 7, name: 'Renamed List' });
	});

	it('creates a list and returns the published response', async () => {
		const input = { name: 'New List' };

		const response = await playerListWriteModule().createPlayerList({
			eventId: 1,
			input,
			originConnectionId: 'origin-1',
		});

		expect(mockPlayerListService.create).toHaveBeenCalledWith(1, input);
		expect(mockPublication.playerListCreated).toHaveBeenCalledWith({
			eventId: 1,
			entity: expect.objectContaining({ id: 7, name: 'New List' }),
			originConnectionId: 'origin-1',
		});
		expect(response).toEqual({ id: 7, name: 'New List' });
	});

	it('updates a list and returns the published response', async () => {
		const input = { name: 'Renamed List' };

		const response = await playerListWriteModule().updatePlayerList({
			eventId: 1,
			listId: 7,
			input,
			originConnectionId: 'origin-1',
		});

		expect(mockPlayerListService.update).toHaveBeenCalledWith(7, 1, input);
		expect(mockPublication.playerListUpdated).toHaveBeenCalledWith({
			eventId: 1,
			entity: expect.objectContaining({ id: 7, name: 'Renamed List' }),
			originConnectionId: 'origin-1',
		});
		expect(response).toEqual({ id: 7, name: 'Renamed List' });
	});

	it('returns 404 when updating a missing list', async () => {
		mockPlayerListService.update.mockResolvedValue(undefined);

		await expect(playerListWriteModule().updatePlayerList({
			eventId: 1,
			listId: 404,
			input: { name: 'Missing' },
		})).rejects.toMatchObject({
			statusCode: 404,
			message: 'Player list not found',
		});

		expect(mockPublication.playerListUpdated).not.toHaveBeenCalled();
	});

	it('deletes a list and publishes the deletion', async () => {
		const response = await playerListWriteModule().deletePlayerList({
			eventId: 1,
			listId: 7,
			originConnectionId: 'origin-1',
		});

		expect(mockPlayerListService.remove).toHaveBeenCalledWith(7, 1);
		expect(mockPublication.playerListDeleted).toHaveBeenCalledWith({
			eventId: 1,
			id: 7,
			originConnectionId: 'origin-1',
		});
		expect(response).toEqual({ success: true });
	});

	it('returns 404 when deleting a missing list', async () => {
		mockPlayerListService.remove.mockResolvedValue(false);

		await expect(playerListWriteModule().deletePlayerList({
			eventId: 1,
			listId: 404,
		})).rejects.toMatchObject({
			statusCode: 404,
			message: 'Player list not found',
		});

		expect(mockPublication.playerListDeleted).not.toHaveBeenCalled();
	});

	it('adds members, recounts, and publishes an added change', async () => {
		const response = await playerListWriteModule().addPlayerListMembers({
			eventId: 1,
			listId: 7,
			playerIds: [10, 11],
			originConnectionId: 'origin-1',
		});

		expect(mockPlayerListService.addMembers).toHaveBeenCalledWith(7, 1, [10, 11]);
		expect(mockPlayerListService.getMemberCount).toHaveBeenCalledWith(7, 1);
		expect(mockPublication.playerListMembersChanged).toHaveBeenCalledWith({
			eventId: 1,
			listId: 7,
			playerIds: [10, 11],
			action: 'added',
			memberCount: 5,
			originConnectionId: 'origin-1',
		});
		expect(response).toEqual({ added: 2, memberCount: 5 });
	});

	it('removes a member, recounts, and publishes a removed change', async () => {
		const response = await playerListWriteModule().removePlayerListMember({
			eventId: 1,
			listId: 7,
			playerId: 10,
			originConnectionId: 'origin-1',
		});

		expect(mockPlayerListService.removeMember).toHaveBeenCalledWith(7, 1, 10);
		expect(mockPublication.playerListMembersChanged).toHaveBeenCalledWith({
			eventId: 1,
			listId: 7,
			playerIds: [10],
			action: 'removed',
			memberCount: 5,
			originConnectionId: 'origin-1',
		});
		expect(response).toEqual({ success: true, memberCount: 5 });
	});

	it('returns 404 when removing a missing member', async () => {
		mockPlayerListService.removeMember.mockResolvedValue(false);

		await expect(playerListWriteModule().removePlayerListMember({
			eventId: 1,
			listId: 7,
			playerId: 404,
		})).rejects.toMatchObject({
			statusCode: 404,
			message: 'Player list member not found',
		});

		expect(mockPlayerListService.getMemberCount).not.toHaveBeenCalled();
		expect(mockPublication.playerListMembersChanged).not.toHaveBeenCalled();
	});

	it('batch-removes members, recounts, and publishes a removed change', async () => {
		const response = await playerListWriteModule().batchRemovePlayerListMembers({
			eventId: 1,
			listId: 7,
			playerIds: [10, 11, 12],
			originConnectionId: 'origin-1',
		});

		expect(mockPlayerListService.batchRemoveMembers).toHaveBeenCalledWith(7, 1, [10, 11, 12]);
		expect(mockPublication.playerListMembersChanged).toHaveBeenCalledWith({
			eventId: 1,
			listId: 7,
			playerIds: [10, 11, 12],
			action: 'removed',
			memberCount: 5,
			originConnectionId: 'origin-1',
		});
		expect(response).toEqual({ removed: 3, memberCount: 5 });
	});

	it('reorders members, recounts, and publishes a reordered change', async () => {
		const response = await playerListWriteModule().reorderPlayerListMembers({
			eventId: 1,
			listId: 7,
			playerIds: [12, 10, 11],
			originConnectionId: 'origin-1',
		});

		expect(mockPlayerListService.reorderMembers).toHaveBeenCalledWith(7, 1, [12, 10, 11]);
		expect(mockPublication.playerListMembersChanged).toHaveBeenCalledWith({
			eventId: 1,
			listId: 7,
			playerIds: [12, 10, 11],
			action: 'reordered',
			memberCount: 5,
			originConnectionId: 'origin-1',
		});
		expect(response).toEqual({ reordered: 4, memberCount: 5 });
	});
});
