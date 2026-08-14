import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { refusalFrom } from '~~/test/helpers/publicServerFailure';

const {
	mockAuthorizeCapability,
	mockUnplayableRevisions,
	mockSetCookie,
	mockSetResponseHeader,
} = vi.hoisted(() => ({
	mockAuthorizeCapability: vi.fn(),
	mockUnplayableRevisions: vi.fn(),
	mockSetCookie: vi.fn(),
	mockSetResponseHeader: vi.fn(),
}));

vi.mock('~~/server/modules/graphics-asset-library/runtime', () => ({
	graphicsCatalogueClient: () => ({}),
}));

vi.mock('~~/server/modules/screen-output-assets/authorizer', () => ({
	createD1ScreenOutputAssetAuthorizer: () => ({
		authorizeCapability: mockAuthorizeCapability,
		unplayableRevisions: mockUnplayableRevisions,
	}),
}));

vi.mock('~~/server/modules/screen-output-assets/capability', () => ({
	screenOutputAssetCapabilityDigest: async () => 'digest',
}));

vi.mock('~~/server/utils/screenOutputCapabilityAuthorization', () => ({
	bearerScreenOutputCapability: (value: string | undefined) =>
		value === undefined ? undefined : value.replace('Bearer ', ''),
}));

vi.stubGlobal('defineEventHandler', vi.fn(handler => handler));
vi.stubGlobal('getValidatedRouterParams', vi.fn(async () => ({ screenId: 42 })));
vi.stubGlobal('getRequestHeader', vi.fn((
	event: { headers?: Record<string, string> },
	name: string,
) => event.headers?.[name]));
vi.stubGlobal('getRequestURL', vi.fn(() => new URL('https://output.invalid/')));
vi.stubGlobal('setCookie', mockSetCookie);
vi.stubGlobal('setResponseHeader', mockSetResponseHeader);
vi.stubGlobal('createError', (input: { statusCode: number; message: string; cause?: unknown }) =>
	Object.assign(new Error(input.message), input));

const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15 Version/18.5 Safari/605.1.15';

function sessionRequest(userAgent = SAFARI) {
	return stubH3Event({
		headers: { 'authorization': 'Bearer opaque_capability', 'user-agent': userAgent },
	});
}

async function handler() {
	return (await import(
		'../../../../../../../server/api/screen-output/screens/[screenId]/asset-capability-session.post',
	)).default;
}

describe('screen Output asset capability session', () => {
	beforeEach(() => {
		vi.resetModules();
		mockAuthorizeCapability.mockReset().mockResolvedValue({ outcome: 'authorized' });
		mockUnplayableRevisions.mockReset().mockResolvedValue([]);
		mockSetCookie.mockReset();
		mockSetResponseHeader.mockReset();
	});

	it('names the revisions this engine will be refused', async () => {
		mockUnplayableRevisions.mockResolvedValue([
			{ assetId: 'asset-1', revisionId: 'revision-7', code: 'vp9-alpha-chromium-required' },
		]);

		const session = await (await handler())(sessionRequest());

		expect(session).toEqual({
			unplayableRevisions: [
				{ assetId: 'asset-1', revisionId: 'revision-7', code: 'vp9-alpha-chromium-required' },
			],
		});
	});

	/**
	 * The forecast is advisory, and the session is not (#184).
	 *
	 * An output refused a session resolves no content URL for *anything*, which is
	 * the whole-output loss #98 closed. Computing the forecast is a second query
	 * against optional data, so letting it fail the session would reopen that fault
	 * by a new route: one unreadable advisory list would cost the operator every
	 * image, video, and font the Screen publishes.
	 */
	it('still opens the session when the forecast cannot be computed', async () => {
		mockUnplayableRevisions.mockRejectedValue(new Error('catalogue is unavailable'));

		const session = await (await handler())(sessionRequest());

		// Opened, cookied, and resolvable — the output loses only the forecast.
		expect(session).toEqual({ unplayableRevisions: [] });
		expect(mockSetCookie).toHaveBeenCalledOnce();
	});

	it('still refuses the session when the capability itself cannot be checked', async () => {
		// The authorization is not advisory: answering an unverified capability would
		// hand out a session nobody proved this output holds.
		mockAuthorizeCapability.mockRejectedValue(new Error('catalogue is unavailable'));

		await expect((await handler())(sessionRequest())).rejects.toMatchObject({ statusCode: 503 });
		expect(mockSetCookie).not.toHaveBeenCalled();
	});

	/**
	 * #321. The refusal above was raised with no cause at all, so the sanitizer replaced
	 * its sentence with 'Internal Server Error'. An output refused a session resolves no
	 * content URL for anything the Screen publishes, so this is the whole of what an
	 * operator staring at a blank output was given.
	 *
	 * Asserted after the mapper, which is the only place the rewrite happens: the row
	 * above passes with the fix reverted and this one does not.
	 */
	it('says the session store is what is unavailable, after the 5xx sanitizer', async () => {
		mockAuthorizeCapability.mockRejectedValue(new Error('D1_ERROR: network error'));
		const event = sessionRequest();

		const failure = await refusalFrom((await handler())(event));

		expect(failure).toMatchObject({
			statusCode: 503,
			statusMessage: 'Service Unavailable',
			message: 'Screen Output asset capability session is temporarily unavailable',
		});
		expect(mockSetResponseHeader).toHaveBeenCalledWith(event, 'retry-after', 5);
	});

	it('keeps the store\'s own words out of the response and in the cause', async () => {
		// The authorizer's exception names a binding and a provider, which is a fact
		// about this server's insides. It is kept as the cause, where a debugger can
		// reach it, and never becomes prose a caller is shown.
		//
		// Note where the assertion finds it: `cause.cause`, which is one level deeper
		// than `errorLogFields` reads. So the failure log does not carry it either —
		// that line names this class, not the store's refusal.
		mockAuthorizeCapability.mockRejectedValue(new Error('D1_ERROR: network error'));

		const failure = await refusalFrom((await handler())(sessionRequest()));

		expect(failure.message).not.toContain('D1_ERROR');
		expect((failure.cause as { cause?: unknown })?.cause).toMatchObject({
			message: 'D1_ERROR: network error',
		});
	});

	it('refuses a capability this Screen does not know, and forecasts nothing for it', async () => {
		mockAuthorizeCapability.mockResolvedValue({ outcome: 'missing' });

		await expect((await handler())(sessionRequest())).rejects.toMatchObject({ statusCode: 404 });
		expect(mockUnplayableRevisions).not.toHaveBeenCalled();
		expect(mockSetCookie).not.toHaveBeenCalled();
	});
});
