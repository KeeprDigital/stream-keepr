import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import * as schema from '~~/server/db/schema';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// The realtime token (ADR-0010): never issued anonymously, a bearer's grant narrowed to its own
// Screen with the Event taken from the capability, and the client identity pinned. The Event is
// a real row; Ably's signing, the session and the Screen Output capability ports are stood in for.

const mockCreateTokenRequest = vi.fn();
const mockGetAblyClient = vi.fn(() => ({
	auth: {
		createTokenRequest: mockCreateTokenRequest,
	},
}));
const mockGetValidatedQuery = vi.fn();
const mockOptionalUserSession = vi.fn();
const mockScreenForCapability = vi.fn();
const mockGetRequestHeader = vi.fn();

vi.mock('~~/server/utils/ably', () => ({
	getAblyClient: mockGetAblyClient,
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

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));

// The one Event there is, under the id every request names unless it says otherwise.
await db.insert(schema.events).values({
	id: 5,
	name: 'Event',
	game: 'mtg',
	featureMatchOrientation: 'horizontal',
});

const handler = (await import('~~/server/api/realtime/token.get')).default;

/** A capability long enough to be one, as `bearerScreenOutputCapability` reads it. */
const CAPABILITY = 'a-screen-output-capability-token';

/** A signed-in operator, as `optionalUserSession` answers. */
function signedIn(userId = 'user-1') {
	mockOptionalUserSession.mockResolvedValue({
		user: { id: userId },
		session: { id: 'session-1' },
	});
}

/** The query the request carries, read through the route's own schema. */
function asking(query: Record<string, unknown>) {
	mockGetValidatedQuery.mockImplementation(async (_event, parse) => parse(query));
}

afterAll(async () => await harness.close());

describe('/api/realtime/token', () => {
	beforeEach(() => {
		mockGetAblyClient.mockClear();
		mockCreateTokenRequest.mockReset();
		mockCreateTokenRequest.mockResolvedValue({ token: 'test-token-request' });
		mockGetValidatedQuery.mockReset();
		asking({ eventId: '5' });
		mockOptionalUserSession.mockReset().mockResolvedValue(null);
		mockScreenForCapability.mockReset().mockResolvedValue(null);
		mockGetRequestHeader.mockReset().mockReturnValue(undefined);
	});

	describe('a signed-in user', () => {
		it('gets the Event and every Screen channel under it, as themselves', async () => {
			signedIn('user-42');

			await expect(handler(stubH3Event())).resolves.toEqual({ token: 'test-token-request' });

			expect(mockCreateTokenRequest).toHaveBeenCalledWith({
				// The user's own id: a wildcard would let the holder claim any identity
				// on the channels it was granted.
				clientId: 'user-42',
				capability: {
					'event:5': ['subscribe', 'history'],
					'screen:5:*': ['subscribe', 'history', 'presence'],
				},
			});
		});

		it('is refused an Event that does not exist', async () => {
			signedIn();
			asking({ eventId: '999' });

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

			await expect(handler(stubH3Event())).resolves.toEqual({ token: 'test-token-request' });

			expect(mockScreenForCapability).toHaveBeenCalledWith({ capabilityDigest: `digest-of-${CAPABILITY}` });
			expect(mockCreateTokenRequest).toHaveBeenCalledWith({
				clientId: 'screen-output:7',
				capability: {
					// No history: an output reads nothing from before it attached, so its
					// credential cannot fetch what was published while it was not there.
					'event:5': ['subscribe'],
					// The Screen itself, not the `screen:5:*` wildcard a session gets.
					'screen:5:7': ['subscribe', 'presence'],
				},
				// Short-lived: a regenerated capability stops hearing within minutes,
				// where Ably's default would keep the old one listening for an hour.
				ttl: 10 * 60 * 1000,
			});
		});

		// A Screen Output has no session and must not need one: an arm that consulted
		// it would go dark the moment the boundary was doing its job.
		it('is granted without a session, which is the whole reason this route is exempt', async () => {
			mockScreenForCapability.mockResolvedValue({ screenId: 7, eventId: 5 });

			await handler(stubH3Event());

			expect(mockOptionalUserSession).not.toHaveBeenCalled();
		});

		// The Event is derived from the capability and compared with the one asked for:
		// trusting the query would let one Event's Screen subscribe to another's channels.
		it('cannot ask for a grant on an Event that is not its own', async () => {
			mockScreenForCapability.mockResolvedValue({ screenId: 7, eventId: 6 });

			await expect(handler(stubH3Event())).rejects.toMatchObject({ statusCode: 401 });
			expect(mockCreateTokenRequest).not.toHaveBeenCalled();
		});

		it('is refused when the capability names no Screen at all', async () => {
			mockScreenForCapability.mockResolvedValue(null);

			await expect(handler(stubH3Event())).rejects.toMatchObject({ statusCode: 401 });
			expect(mockCreateTokenRequest).not.toHaveBeenCalled();
		});

		// A page may hold both. Each arm authorizes independently, so a stale capability
		// beside a live session is admitted by the session rather than refused.
		it('falls through to the session arm when its capability is not this Screen\'s', async () => {
			mockScreenForCapability.mockResolvedValue(null);
			signedIn('user-42');

			await expect(handler(stubH3Event())).resolves.toEqual({ token: 'test-token-request' });
			expect(mockCreateTokenRequest).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'user-42' }));
		});
	});

	describe('a caller with neither credential', () => {
		// ADR-0010: no anonymous issuance.
		it('is refused, and never reaches Ably', async () => {
			await expect(handler(stubH3Event())).rejects.toMatchObject({
				statusCode: 401,
				message: 'A session or a Screen Output Asset Capability is required',
			});
			expect(mockGetAblyClient).not.toHaveBeenCalled();
			expect(mockCreateTokenRequest).not.toHaveBeenCalled();
		});

		it('is refused the same way for an Event that does not exist, so the refusal says nothing about it', async () => {
			asking({ eventId: '999' });

			await expect(handler(stubH3Event())).rejects.toMatchObject({
				statusCode: 401,
				message: 'A session or a Screen Output Asset Capability is required',
			});
		});
	});

	describe('the query', () => {
		// As a validation failure, not the 404 an Event lookup on the same value would answer.
		it.each([
			{ fault: 'missing', query: {} },
			{
				fault: 'not positive',
				query: { eventId: '-1' },
			},
		])('is rejected before anything else when the eventId is $fault', async ({ query }) => {
			signedIn();
			asking(query);

			await expect(handler(stubH3Event())).rejects.toBeInstanceOf(ZodError);
			expect(mockCreateTokenRequest).not.toHaveBeenCalled();
		});
	});
});
