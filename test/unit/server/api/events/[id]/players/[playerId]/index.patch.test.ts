import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubH3Event } from '~~/test/helpers/h3Event';

const mockGetValidatedRouterParams = vi.fn();
const mockReadValidatedBody = vi.fn();
const mockGetOriginConnectionId = vi.fn();
const mockUpdatePlayer = vi.fn();
const mockPlayerParamsParse = vi.fn(input => input);
const mockUpdatePlayerParse = vi.fn(input => input);

vi.stubGlobal('defineEventHandler', vi.fn(handler => handler));
vi.stubGlobal('getValidatedRouterParams', mockGetValidatedRouterParams);
vi.stubGlobal('readValidatedBody', mockReadValidatedBody);

vi.mock('~~/server/schemas/api/player', () => ({
	playerParamsSchema: { parse: mockPlayerParamsParse },
	updatePlayerSchema: { parse: mockUpdatePlayerParse },
}));

vi.mock('~~/server/utils/ably', () => ({
	getOriginConnectionId: mockGetOriginConnectionId,
}));

vi.mock('~~/server/modules/player-update', () => ({
	playerUpdateModule: () => ({
		updatePlayer: mockUpdatePlayer,
	}),
}));

describe('patch /api/events/[id]/players/[playerId]', () => {
	beforeEach(() => {
		vi.resetModules();
		mockGetValidatedRouterParams.mockReset().mockResolvedValue({ id: 1, playerId: 5 });
		mockReadValidatedBody.mockReset().mockResolvedValue({ name: 'Updated Player' });
		mockGetOriginConnectionId.mockReset().mockReturnValue('origin-1');
		mockUpdatePlayer.mockReset().mockResolvedValue({ id: 5, eventId: 1, name: 'Updated Player' });
		mockPlayerParamsParse.mockClear();
		mockUpdatePlayerParse.mockClear();
	});

	it('parses params and body, then delegates Player update workflow', async () => {
		const handler = (await import('~~/server/api/events/[id]/players/[playerId]/index.patch.ts')).default;
		const event = stubH3Event();

		await expect(handler(event)).resolves.toEqual({ id: 5, eventId: 1, name: 'Updated Player' });

		expect(mockGetValidatedRouterParams).toHaveBeenCalledWith(event, mockPlayerParamsParse);
		expect(mockReadValidatedBody).toHaveBeenCalledWith(event, mockUpdatePlayerParse);
		expect(mockGetOriginConnectionId).toHaveBeenCalledWith(event);
		expect(mockUpdatePlayer).toHaveBeenCalledWith({
			eventId: 1,
			playerId: 5,
			input: { name: 'Updated Player' },
			originConnectionId: 'origin-1',
		});
	});
});
