import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetValidatedRouterParams = vi.fn();
const mockReadValidatedBody = vi.fn();
const mockSetResponseStatus = vi.fn();
const mockGetOriginConnectionId = vi.fn();
const mockAddMembers = vi.fn();
const mockGetMemberCount = vi.fn();
const mockPlayerListMembersChanged = vi.fn();

vi.stubGlobal('defineEventHandler', vi.fn(handler => handler));
vi.stubGlobal('getValidatedRouterParams', mockGetValidatedRouterParams);
vi.stubGlobal('readValidatedBody', mockReadValidatedBody);
vi.stubGlobal('setResponseStatus', mockSetResponseStatus);

vi.mock('~~/server/services/playerList', () => ({
	playerListService: () => ({
		addMembers: mockAddMembers,
		getMemberCount: mockGetMemberCount,
	}),
}));

vi.mock('~~/server/modules/event-data-publication', () => ({
	eventDataPublicationModule: () => ({
		playerListMembersChanged: mockPlayerListMembersChanged,
	}),
}));

vi.mock('~~/server/utils/ably', () => ({
	getOriginConnectionId: mockGetOriginConnectionId,
}));

describe('post /api/events/[id]/player-lists/[listId]/members', () => {
	beforeEach(() => {
		vi.resetModules();
		mockGetValidatedRouterParams.mockReset().mockResolvedValue({ id: 1, listId: 10 });
		mockReadValidatedBody.mockReset().mockResolvedValue({ playerIds: [101, 102] });
		mockSetResponseStatus.mockReset();
		mockGetOriginConnectionId.mockReset().mockReturnValue('origin-1');
		mockAddMembers.mockReset().mockResolvedValue({ added: 2 });
		mockGetMemberCount.mockReset().mockResolvedValue(4);
		mockPlayerListMembersChanged.mockReset().mockResolvedValue(undefined);
	});

	it('publishes member change after persistence', async () => {
		const handler = (await import('../../../../../../../../../server/api/events/[id]/player-lists/[listId]/members.post.ts')).default;

		await expect(handler({})).resolves.toEqual({ added: 2, memberCount: 4 });

		expect(mockAddMembers).toHaveBeenCalledWith(10, 1, [101, 102]);
		expect(mockGetMemberCount).toHaveBeenCalledWith(10, 1);
		expect(mockPlayerListMembersChanged).toHaveBeenCalledWith({
			eventId: 1,
			listId: 10,
			playerIds: [101, 102],
			action: 'added',
			memberCount: 4,
			originConnectionId: 'origin-1',
		});
		expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 201);
	});
});
