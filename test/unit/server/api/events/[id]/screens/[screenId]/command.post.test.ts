import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetValidatedRouterParams = vi.fn();
const mockReadValidatedBody = vi.fn();
const mockFindById = vi.fn();
const mockPublishScreenCommand = vi.fn();

vi.stubGlobal('defineEventHandler', vi.fn(handler => handler));
vi.stubGlobal('getValidatedRouterParams', mockGetValidatedRouterParams);
vi.stubGlobal('readValidatedBody', mockReadValidatedBody);
vi.stubGlobal('createError', (input: { statusCode: number; message: string }) => Object.assign(new Error(input.message), input));

vi.mock('~~/server/services/screen', () => ({
	screenService: () => ({ findById: mockFindById }),
}));

vi.mock('~~/server/utils/ably', () => ({
	publishScreenCommand: mockPublishScreenCommand,
}));

describe('post /api/events/[id]/screens/[screenId]/command', () => {
	beforeEach(() => {
		vi.resetModules();
		mockGetValidatedRouterParams.mockReset().mockResolvedValue({ id: 1, screenId: 10 });
		mockReadValidatedBody.mockReset().mockResolvedValue({ command: 'refresh' });
		mockFindById.mockReset().mockResolvedValue({ id: 10, eventId: 1 });
		mockPublishScreenCommand.mockReset().mockResolvedValue(undefined);
	});

	it('publishes a command to an existing screen', async () => {
		const handler = (await import('../../../../../../../../server/api/events/[id]/screens/[screenId]/command.post.ts')).default;

		await expect(handler({})).resolves.toEqual({ ok: true });

		expect(mockFindById).toHaveBeenCalledWith(10, 1);
		expect(mockPublishScreenCommand).toHaveBeenCalledWith(1, 10, 'refresh');
	});
});
