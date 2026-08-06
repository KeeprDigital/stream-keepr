import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubH3Event } from '~~/test/helpers/h3Event';

const mockCreateTokenRequest = vi.fn();
const mockGetAblyClient = vi.fn(() => ({
	auth: {
		createTokenRequest: mockCreateTokenRequest,
	},
}));
const mockGetValidatedQuery = vi.fn();
const mockExists = vi.fn();

vi.mock('~~/server/utils/ably', () => ({
	getAblyClient: mockGetAblyClient,
}));

vi.mock('~~/server/services/event', () => ({
	eventService: () => ({ exists: mockExists }),
}));

vi.stubGlobal('defineEventHandler', vi.fn(handler => handler));
vi.stubGlobal('getValidatedQuery', mockGetValidatedQuery);
vi.stubGlobal('createError', (input: { statusCode: number; message: string }) => Object.assign(new Error(input.message), input));

describe('/api/realtime/token', () => {
	beforeEach(() => {
		vi.resetModules();
		mockGetAblyClient.mockClear();
		mockCreateTokenRequest.mockReset();
		mockCreateTokenRequest.mockResolvedValue({ token: 'test-token-request' });
		mockGetValidatedQuery.mockReset();
		mockExists.mockReset().mockResolvedValue(true);
	});

	it('requests a token scoped to the given event with screen presence but no publish capabilities', async () => {
		mockGetValidatedQuery.mockImplementation(async (_event, parse) => parse({ eventId: '5' }));
		const handler = (await import('../../../../../server/api/realtime/token.get.ts')).default;

		await expect(handler(stubH3Event())).resolves.toEqual({ token: 'test-token-request' });

		expect(mockExists).toHaveBeenCalledWith(5);
		expect(mockGetAblyClient).toHaveBeenCalledOnce();
		expect(mockCreateTokenRequest).toHaveBeenCalledWith({
			clientId: '*',
			capability: {
				'event:5': ['subscribe', 'history'],
				'screen:5:*': ['subscribe', 'history', 'presence'],
			},
		});
	});

	it('rejects a request missing eventId before touching Ably', async () => {
		mockGetValidatedQuery.mockImplementation(async (_event, parse) => parse({}));
		const handler = (await import('../../../../../server/api/realtime/token.get.ts')).default;

		await expect(handler(stubH3Event())).rejects.toThrow();
		expect(mockExists).not.toHaveBeenCalled();
		expect(mockCreateTokenRequest).not.toHaveBeenCalled();
	});

	it('rejects a non-positive eventId before touching Ably', async () => {
		mockGetValidatedQuery.mockImplementation(async (_event, parse) => parse({ eventId: '-1' }));
		const handler = (await import('../../../../../server/api/realtime/token.get.ts')).default;

		await expect(handler(stubH3Event())).rejects.toThrow();
		expect(mockExists).not.toHaveBeenCalled();
		expect(mockCreateTokenRequest).not.toHaveBeenCalled();
	});

	it('returns 404 when the event does not exist', async () => {
		mockGetValidatedQuery.mockImplementation(async (_event, parse) => parse({ eventId: '999' }));
		mockExists.mockResolvedValue(false);
		const handler = (await import('../../../../../server/api/realtime/token.get.ts')).default;

		await expect(handler(stubH3Event())).rejects.toMatchObject({ statusCode: 404 });
		expect(mockCreateTokenRequest).not.toHaveBeenCalled();
	});
});
