import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { refusalFrom } from '~~/test/helpers/publicServerFailure';

const { mockDeliver, mockSetResponseHeader } = vi.hoisted(() => ({
	mockDeliver: vi.fn(),
	mockSetResponseHeader: vi.fn(),
}));

vi.mock('~~/server/modules/screen-output-assets/runtime', () => ({
	screenOutputAssetDeliveryForEvent: async () => ({ deliver: mockDeliver }),
}));

vi.mock('~~/server/utils/screenOutputCapabilityAuthorization', () => ({
	bearerScreenOutputCapability: (value: string | undefined) =>
		value === undefined ? undefined : value.replace('Bearer ', ''),
}));

vi.stubGlobal('defineEventHandler', vi.fn(handler => handler));
vi.stubGlobal('getValidatedRouterParams', vi.fn(async () => ({
	screenId: 42,
	assetId: 'asset-1',
	revisionId: 'revision-1',
})));
vi.stubGlobal('getRequestHeader', vi.fn((
	event: { headers?: Record<string, string> },
	name: string,
) => event.headers?.[name]));
vi.stubGlobal('getRequestHeaders', vi.fn((event: { headers?: Record<string, string> }) => event.headers ?? {}));
vi.stubGlobal('getCookie', vi.fn(() => undefined));
vi.stubGlobal('setResponseHeader', mockSetResponseHeader);
vi.stubGlobal('createError', (input: {
	statusCode: number;
	statusMessage?: string;
	message: string;
	cause?: unknown;
	data?: unknown;
}) => Object.assign(new Error(input.message), input));

async function handler() {
	return (await import(
		'../../../../../../../../server/api/screen-output/screens/[screenId]/assets/[assetId]/revisions/[revisionId]/content.get',
	)).default;
}

function outputRequest() {
	return stubH3Event({ headers: { authorization: 'Bearer opaque_capability' } });
}

/**
 * The bytes an on-air Screen Output asks for by capability, and what it is told when
 * they cannot be served.
 *
 * The file exists for #321: this route's 503 was one of seven raised with no cause, so
 * the sanitizer replaced its sentence with 'Internal Server Error'. This is the refusal
 * an output meets while an item is already missing from air, and a placeholder does not
 * distinguish a store that will be back in a moment from a Screen that has to be
 * reconfigured.
 */
describe('screen Output asset content delivery', () => {
	beforeEach(() => {
		vi.resetModules();
		mockDeliver.mockReset();
		mockSetResponseHeader.mockReset();
	});

	it('returns the delivery response untouched when the capability resolves', async () => {
		const delivered = new Response('bytes', { status: 200 });
		mockDeliver.mockResolvedValue({ outcome: 'delivered', response: delivered });

		await expect((await handler())(outputRequest())).resolves.toBe(delivered);
	});

	it('answers a revision this Screen does not publish with 404', async () => {
		mockDeliver.mockResolvedValue({ outcome: 'missing' });

		await expect((await handler())(outputRequest())).rejects.toMatchObject({
			statusCode: 404,
			message: 'Graphic Asset Revision is not available to this Screen Output',
		});
	});

	/**
	 * Asserted after the mapper, because that is the only place the rewrite happens: a
	 * row reading the thrown error passes with the fix reverted.
	 */
	it('says what is unavailable when the delivery cannot reach the bytes', async () => {
		mockDeliver.mockResolvedValue({ outcome: 'unavailable' });
		const event = outputRequest();

		const failure = await refusalFrom((await handler())(event));

		expect(failure).toMatchObject({
			statusCode: 503,
			statusMessage: 'Service Unavailable',
			message: 'Screen Output asset delivery is temporarily unavailable',
		});
		expect(mockSetResponseHeader).toHaveBeenCalledWith(event, 'retry-after', 5);
	});

	it('keeps the incompatible-engine refusal a 409 the output prints for itself', async () => {
		// Distinct from both above and unaffected here: the Screen does publish the
		// revision and this browser cannot play it, which the output answers with its
		// own diagnostic in the item's place (#98).
		mockDeliver.mockResolvedValue({ outcome: 'incompatible', code: 'vp9-alpha-chromium-required' });

		await expect((await handler())(outputRequest())).rejects.toMatchObject({
			statusCode: 409,
			data: { code: 'vp9-alpha-chromium-required' },
		});
	});
});
