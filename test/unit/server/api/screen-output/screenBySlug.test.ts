import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubH3Event } from '~~/test/helpers/h3Event';

/**
 * The Screen lookup by slug, on the capability surface (#397, ADR-0010).
 *
 * This route was fully public until #396 made it private and #397 moved it here, and
 * what it answers is the bootstrap a Screen Output cannot start without: the Screen
 * its slug names. Three things are pinned, because each would be invisible from a
 * response that looked fine:
 *
 * - **one refusal for every way of not being allowed to ask.** A missing Screen, a
 *   capability for a different Screen, and no credential at all are the same 404, so
 *   nothing here can be used to find out which Screens exist.
 * - **the capability arm needs no session.** An output has none; a route that
 *   consulted one anyway would go dark exactly when the boundary started working.
 * - **the session arm exists at all.** The editor's `embed=preview` surfaces hold no
 *   capability by design, so a capability-only gate — which is what the ticket asks
 *   for literally — would leave them rendering nothing.
 */

const mockFindBySlug = vi.fn();
const mockOptionalUserSession = vi.fn();
const mockGetRequestHeader = vi.fn();
const mockGetValidatedRouterParams = vi.fn();

vi.mock('~~/server/services/screen', () => ({
	screenService: () => ({ findBySlug: mockFindBySlug }),
}));

vi.mock('~~/server/utils/auth', () => ({
	optionalUserSession: mockOptionalUserSession,
}));

vi.mock('~~/server/utils/eventId', () => ({
	getEventId: async () => 5,
}));

// The real mapper strips the capability digest; asserted separately below, because
// "the response never carries it" is the property, not "this mapper was called".
vi.mock('~~/server/mappers/screen', async importOriginal => importOriginal<object>());

vi.stubGlobal('defineEventHandler', vi.fn(handler => handler));
vi.stubGlobal('getRequestHeader', mockGetRequestHeader);
vi.stubGlobal('getValidatedRouterParams', mockGetValidatedRouterParams);
vi.stubGlobal('createError', (input: { statusCode: number; message: string }) =>
	Object.assign(new Error(input.message), input));

const CAPABILITY = 'a-screen-output-capability-token';

/**
 * The digest of `CAPABILITY`, computed the way the server does.
 *
 * Through the real `screenOutputAssetCapabilityDigest` rather than a stub, because
 * what the route compares is a digest against the one stored on the row — and a
 * stubbed hash would let a comparison bug pass by agreeing with itself.
 */
async function capabilityDigest(capability: string): Promise<string> {
	const { screenOutputAssetCapabilityDigest } = await import(
		'~~/server/modules/screen-output-assets/capability',
	);
	return await screenOutputAssetCapabilityDigest(capability);
}

function screenRow(assetCapabilityDigest: string) {
	return {
		id: 7,
		eventId: 5,
		name: 'Programme',
		slug: 'programme',
		assetCapabilityDigest,
		currentMode: 'card',
		modeConfigs: {},
		stateVersion: 1,
		createdAt: new Date(0),
		updatedAt: new Date(0),
	};
}

async function slugRoute() {
	return (await import(
		'../../../../../server/api/screen-output/events/[id]/screens/slug/[slug].get',
	)).default;
}

describe('the Screen lookup by slug', () => {
	beforeEach(() => {
		vi.resetModules();
		mockFindBySlug.mockReset();
		mockOptionalUserSession.mockReset().mockResolvedValue(null);
		mockGetRequestHeader.mockReset().mockReturnValue(undefined);
		mockGetValidatedRouterParams.mockReset()
			.mockImplementation(async (_event, parse) => parse({ slug: 'programme' }));
	});

	it('answers a bearer holding this Screen\'s capability', async () => {
		mockFindBySlug.mockResolvedValue(screenRow(await capabilityDigest(CAPABILITY)));
		mockGetRequestHeader.mockReturnValue(`Bearer ${CAPABILITY}`);
		const handler = await slugRoute();

		await expect(handler(stubH3Event())).resolves.toMatchObject({ id: 7, slug: 'programme' });
	});

	it('answers it without asking about a session, which an output does not have', async () => {
		mockFindBySlug.mockResolvedValue(screenRow(await capabilityDigest(CAPABILITY)));
		mockGetRequestHeader.mockReturnValue(`Bearer ${CAPABILITY}`);
		const handler = await slugRoute();

		await handler(stubH3Event());

		expect(mockOptionalUserSession).not.toHaveBeenCalled();
	});

	it('never returns the capability digest it compared against', async () => {
		// The digest is the stored half of the credential. `mapScreenToResponse` strips
		// it, and this is the route that holds a row carrying one in the same scope as
		// its own response.
		mockFindBySlug.mockResolvedValue(screenRow(await capabilityDigest(CAPABILITY)));
		mockGetRequestHeader.mockReturnValue(`Bearer ${CAPABILITY}`);
		const handler = await slugRoute();

		const response = await handler(stubH3Event());

		expect(JSON.stringify(response)).not.toContain(await capabilityDigest(CAPABILITY));
		expect(response).not.toHaveProperty('assetCapabilityDigest');
	});

	it('answers an operator with a session and no capability, for the preview embeds', async () => {
		mockFindBySlug.mockResolvedValue(screenRow('some-other-screens-digest'));
		mockOptionalUserSession.mockResolvedValue({ user: { id: 'user-1' }, session: { id: 'session-1' } });
		const handler = await slugRoute();

		await expect(handler(stubH3Event())).resolves.toMatchObject({ id: 7 });
	});

	it.each([
		['no credential at all', undefined, false],
		['a capability for a different Screen', `Bearer ${CAPABILITY}`, false],
	] as const)('refuses %s with the same 404 a missing Screen gets', async (_case, authorization, hasSession) => {
		mockFindBySlug.mockResolvedValue(screenRow('some-other-screens-digest'));
		mockGetRequestHeader.mockReturnValue(authorization);
		mockOptionalUserSession.mockResolvedValue(hasSession ? { user: { id: 'u' }, session: {} } : null);
		const handler = await slugRoute();

		await expect(handler(stubH3Event())).rejects.toMatchObject({
			statusCode: 404,
			message: 'Screen not found',
		});
	});

	it('refuses an unknown slug with that same 404, so the two are indistinguishable', async () => {
		// The point of the uniform refusal: a caller cannot use this route to learn
		// which slugs exist, whatever credential it holds or does not.
		mockFindBySlug.mockResolvedValue(undefined);
		const handler = await slugRoute();

		await expect(handler(stubH3Event())).rejects.toMatchObject({
			statusCode: 404,
			message: 'Screen not found',
		});
	});

	it('refuses a bearer that is not shaped like a capability without comparing it', async () => {
		// `bearerScreenOutputCapability` reads nothing out of a malformed header, so
		// the route sees no capability rather than a wrong one — and falls through to
		// the session arm, which here is empty.
		mockFindBySlug.mockResolvedValue(screenRow(await capabilityDigest(CAPABILITY)));
		mockGetRequestHeader.mockReturnValue('Bearer short');
		const handler = await slugRoute();

		await expect(handler(stubH3Event())).rejects.toMatchObject({ statusCode: 404 });
	});
});
