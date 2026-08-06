import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubH3Event } from '~~/test/helpers/h3Event';

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
vi.stubGlobal('createError', (input: { statusCode: number; message: string }) =>
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

	it('refuses a capability this Screen does not know, and forecasts nothing for it', async () => {
		mockAuthorizeCapability.mockResolvedValue({ outcome: 'missing' });

		await expect((await handler())(sessionRequest())).rejects.toMatchObject({ statusCode: 404 });
		expect(mockUnplayableRevisions).not.toHaveBeenCalled();
		expect(mockSetCookie).not.toHaveBeenCalled();
	});
});
