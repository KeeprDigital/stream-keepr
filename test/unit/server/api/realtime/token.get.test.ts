import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubH3Event } from '~~/test/helpers/h3Event';

/**
 * The realtime token's dual grant (#397, ADR-0010).
 *
 * Until this ticket the route handed **any** caller `clientId: '*'` over every
 * channel of any Event they named — the hole its place on the boundary's allowlist
 * was keeping open, since ADR-0010 exempts it only because a Screen Output has no
 * session to present. Three properties are pinned here, and each is a thing that
 * would be invisible from the response if it were wrong:
 *
 * - **no anonymous issuance** — a request with neither credential never reaches Ably;
 * - **the bearer's grant is narrowed** to its own Screen, and the Event is taken from
 *   the capability rather than from the query, so a bearer cannot name somebody else's;
 * - **the identity is pinned**, where the wildcard let a holder claim any.
 */

const mockCreateTokenRequest = vi.fn();
const mockGetAblyClient = vi.fn(() => ({
	auth: {
		createTokenRequest: mockCreateTokenRequest,
	},
}));
const mockGetValidatedQuery = vi.fn();
const mockExists = vi.fn();
const mockOptionalUserSession = vi.fn();
const mockScreenForCapability = vi.fn();
const mockGetRequestHeader = vi.fn();

vi.mock('~~/server/utils/ably', () => ({
	getAblyClient: mockGetAblyClient,
}));

vi.mock('~~/server/services/event', () => ({
	eventService: () => ({ exists: mockExists }),
}));

vi.mock('~~/server/utils/auth', () => ({
	optionalUserSession: mockOptionalUserSession,
}));

vi.mock('~~/server/modules/graphics-asset-library/runtime', () => ({
	graphicsCatalogueClient: () => ({}),
}));

vi.mock('~~/server/modules/screen-output-assets/authorizer', () => ({
	createD1ScreenOutputAssetAuthorizer: () => ({ screenForCapability: mockScreenForCapability }),
}));

// The digest is the capability run through SHA-256; what this route does with it is
// hand it to the authorizer, so the real one adds nothing but a hash to assert on.
vi.mock('~~/server/modules/screen-output-assets/capability', () => ({
	screenOutputAssetCapabilityDigest: async (capability: string) => `digest-of-${capability}`,
}));

vi.stubGlobal('defineEventHandler', vi.fn(handler => handler));
vi.stubGlobal('getValidatedQuery', mockGetValidatedQuery);
vi.stubGlobal('getRequestHeader', mockGetRequestHeader);
vi.stubGlobal('createError', (input: { statusCode: number; message: string }) => Object.assign(new Error(input.message), input));

/** A capability long enough to be one, as `bearerScreenOutputCapability` reads it. */
const CAPABILITY = 'a-screen-output-capability-token';

async function tokenRoute() {
	return (await import('../../../../../server/api/realtime/token.get.ts')).default;
}

/** A signed-in operator, as `optionalUserSession` answers. */
function signedIn(userId = 'user-1') {
	mockOptionalUserSession.mockResolvedValue({ user: { id: userId }, session: { id: 'session-1' } });
}

describe('/api/realtime/token', () => {
	beforeEach(() => {
		vi.resetModules();
		mockGetAblyClient.mockClear();
		mockCreateTokenRequest.mockReset();
		mockCreateTokenRequest.mockResolvedValue({ token: 'test-token-request' });
		mockGetValidatedQuery.mockReset();
		mockGetValidatedQuery.mockImplementation(async (_event, parse) => parse({ eventId: '5' }));
		mockExists.mockReset().mockResolvedValue(true);
		mockOptionalUserSession.mockReset().mockResolvedValue(null);
		mockScreenForCapability.mockReset().mockResolvedValue(null);
		mockGetRequestHeader.mockReset().mockReturnValue(undefined);
	});

	describe('a signed-in user', () => {
		it('gets the Event and every Screen channel under it, as themselves', async () => {
			signedIn('user-42');
			const handler = await tokenRoute();

			await expect(handler(stubH3Event())).resolves.toEqual({ token: 'test-token-request' });

			expect(mockExists).toHaveBeenCalledWith(5);
			expect(mockCreateTokenRequest).toHaveBeenCalledWith({
				// The userId, where this was `'*'` — a wildcard the holder could claim
				// any identity with on the channels it was granted.
				clientId: 'user-42',
				capability: {
					'event:5': ['subscribe', 'history'],
					'screen:5:*': ['subscribe', 'history', 'presence'],
				},
			});
		});

		it('is refused an Event that does not exist', async () => {
			signedIn();
			mockGetValidatedQuery.mockImplementation(async (_event, parse) => parse({ eventId: '999' }));
			mockExists.mockResolvedValue(false);
			const handler = await tokenRoute();

			await expect(handler(stubH3Event())).rejects.toMatchObject({ statusCode: 404 });
			expect(mockCreateTokenRequest).not.toHaveBeenCalled();
		});
	});

	describe('a Screen Output Asset Capability bearer', () => {
		beforeEach(() => {
			mockGetRequestHeader.mockReturnValue(`Bearer ${CAPABILITY}`);
		});

		it('gets its own Screen channel and its Event, and nothing else', async () => {
			mockScreenForCapability.mockResolvedValue({ screenId: 7, eventId: 5 });
			const handler = await tokenRoute();

			await expect(handler(stubH3Event())).resolves.toEqual({ token: 'test-token-request' });

			expect(mockScreenForCapability).toHaveBeenCalledWith({ capabilityDigest: `digest-of-${CAPABILITY}` });
			expect(mockCreateTokenRequest).toHaveBeenCalledWith({
				clientId: 'screen-output:7',
				capability: {
					'event:5': ['subscribe', 'history'],
					// The Screen itself, not the `screen:5:*` wildcard a session gets.
					'screen:5:7': ['subscribe', 'history', 'presence'],
				},
			});
		});

		it('is granted without a session, which is the whole reason this route is exempt', async () => {
			// A Screen Output has none and must not need one. If this arm ever started
			// consulting the session, an output would go dark the moment the boundary
			// was doing its job.
			mockScreenForCapability.mockResolvedValue({ screenId: 7, eventId: 5 });
			const handler = await tokenRoute();

			await handler(stubH3Event());

			expect(mockOptionalUserSession).not.toHaveBeenCalled();
		});

		it('cannot ask for a grant on an Event that is not its own', async () => {
			// The Event is derived from the capability and compared with the one asked
			// for. Trusting the query instead would let a bearer for one Event's Screen
			// subscribe to another Event's channels.
			mockScreenForCapability.mockResolvedValue({ screenId: 7, eventId: 6 });
			const handler = await tokenRoute();

			await expect(handler(stubH3Event())).rejects.toMatchObject({ statusCode: 401 });
			expect(mockCreateTokenRequest).not.toHaveBeenCalled();
		});

		it('is refused when the capability names no Screen at all', async () => {
			mockScreenForCapability.mockResolvedValue(null);
			const handler = await tokenRoute();

			await expect(handler(stubH3Event())).rejects.toMatchObject({ statusCode: 401 });
			expect(mockCreateTokenRequest).not.toHaveBeenCalled();
		});

		it('falls through to the session arm when its capability is not this Screen\'s', async () => {
			// A page may hold both. Each arm authorizes independently, so a stale
			// capability beside a live session is admitted by the session rather than
			// refused by the capability.
			mockScreenForCapability.mockResolvedValue(null);
			signedIn('user-42');
			const handler = await tokenRoute();

			await expect(handler(stubH3Event())).resolves.toEqual({ token: 'test-token-request' });
			expect(mockCreateTokenRequest).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'user-42' }));
		});
	});

	describe('a caller with neither credential', () => {
		it('is refused, and never reaches Ably', async () => {
			// ADR-0010: "no anonymous issuance". Before #397 this same request was
			// answered with a grant over every channel of the Event.
			const handler = await tokenRoute();

			await expect(handler(stubH3Event())).rejects.toMatchObject({
				statusCode: 401,
				message: 'A session or a Screen Output Asset Capability is required',
			});
			expect(mockGetAblyClient).not.toHaveBeenCalled();
			expect(mockCreateTokenRequest).not.toHaveBeenCalled();
		});

		it('is refused before the Event is looked up, so the refusal says nothing about it', async () => {
			const handler = await tokenRoute();

			await expect(handler(stubH3Event())).rejects.toThrow();
			expect(mockExists).not.toHaveBeenCalled();
		});
	});

	describe('the query', () => {
		it('is rejected before anything else when the eventId is missing', async () => {
			signedIn();
			mockGetValidatedQuery.mockImplementation(async (_event, parse) => parse({}));
			const handler = await tokenRoute();

			await expect(handler(stubH3Event())).rejects.toThrow();
			expect(mockExists).not.toHaveBeenCalled();
			expect(mockCreateTokenRequest).not.toHaveBeenCalled();
		});

		it('is rejected when the eventId is not positive', async () => {
			signedIn();
			mockGetValidatedQuery.mockImplementation(async (_event, parse) => parse({ eventId: '-1' }));
			const handler = await tokenRoute();

			await expect(handler(stubH3Event())).rejects.toThrow();
			expect(mockExists).not.toHaveBeenCalled();
			expect(mockCreateTokenRequest).not.toHaveBeenCalled();
		});
	});
});
