import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubH3Event } from '~~/test/helpers/h3Event';

const {
	mockBetterAuthHandler,
	mockGetRequestURL,
	mockLocalAuthBypassIsActive,
	mockRequestUserSession,
	mockToWebRequest,
} = vi.hoisted(() => ({
	mockBetterAuthHandler: vi.fn(),
	mockGetRequestURL: vi.fn(),
	mockLocalAuthBypassIsActive: vi.fn(),
	mockRequestUserSession: vi.fn(),
	mockToWebRequest: vi.fn(),
}));

vi.mock('h3', () => ({ toWebRequest: mockToWebRequest }));
vi.mock('~~/server/utils/auth', () => ({
	localAuthBypassIsActive: mockLocalAuthBypassIsActive,
	requestUserSession: mockRequestUserSession,
	serverAuth: () => ({ handler: mockBetterAuthHandler }),
}));

vi.stubGlobal('defineEventHandler', vi.fn(handler => handler));
vi.stubGlobal('getRequestURL', mockGetRequestURL);

const handler = (await import('~~/server/api/auth/[...all]')).default;
const event = stubH3Event({ headers: new Headers(), context: {} });

describe('the mounted authentication interface', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetRequestURL.mockReturnValue(new URL('http://127.0.0.1:3000/api/auth/get-session'));
	});

	it('answers a Local Developer Session through the ordinary session-reading route', async () => {
		const localSession = { user: { id: 'local-developer-user' }, session: { id: 'local-session' } };
		mockLocalAuthBypassIsActive.mockReturnValue(true);
		mockRequestUserSession.mockResolvedValue(localSession);

		await expect(handler(event)).resolves.toBe(localSession);
		expect(mockBetterAuthHandler).not.toHaveBeenCalled();
	});

	it('leaves the complete Better Auth router unchanged when the bypass is inactive', async () => {
		const request = new Request('http://127.0.0.1:3000/api/auth/get-session');
		mockLocalAuthBypassIsActive.mockReturnValue(false);
		mockToWebRequest.mockReturnValue(request);
		mockBetterAuthHandler.mockResolvedValue(new Response('real auth'));

		const response = await handler(event);

		expect(mockBetterAuthHandler).toHaveBeenCalledWith(request);
		expect(response).toBeInstanceOf(Response);
		expect(await (response as Response).text()).toBe('real auth');
	});
});
