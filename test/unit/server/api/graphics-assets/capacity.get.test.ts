import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubH3Event } from '~~/test/helpers/h3Event';

const {
	mockRequireGraphicsAuthorSession,
	mockGetCapacity,
	mockSetResponseHeader,
} = vi.hoisted(() => ({
	mockRequireGraphicsAuthorSession: vi.fn(),
	mockGetCapacity: vi.fn(),
	mockSetResponseHeader: vi.fn(),
}));

vi.mock('~~/server/modules/graphics-author-session', () => ({
	requireGraphicsAuthorSession: mockRequireGraphicsAuthorSession,
}));

vi.mock('~~/server/modules/graphics-asset-library/runtime', () => ({
	graphicsAssetLibraryForEvent: () => ({
		getCapacity: mockGetCapacity,
	}),
}));

vi.stubGlobal('defineEventHandler', vi.fn(handler => handler));
vi.stubGlobal('setResponseHeader', mockSetResponseHeader);
vi.stubGlobal('createError', (input: {
	statusCode: number;
	statusMessage?: string;
	message: string;
	cause?: unknown;
}) => Object.assign(new Error(input.message), input));

const routePath = '../../../../../server/api/graphics-assets/capacity.get';

describe('installation storage occupancy, as an author reads it', () => {
	beforeEach(() => {
		vi.resetModules();
		mockRequireGraphicsAuthorSession.mockReset().mockResolvedValue('author-1');
		mockGetCapacity.mockReset().mockResolvedValue({ canonical: {}, staging: {} });
		mockSetResponseHeader.mockReset();
	});

	it('maps a retryable capacity read failure to 503 with retry guidance', async () => {
		const { GraphicsAssetLibraryError } = await import('~~/server/modules/graphics-asset-library');
		mockGetCapacity.mockRejectedValue(new GraphicsAssetLibraryError(
			'Graphics capacity is temporarily unavailable',
			'graphics-asset-library-unavailable',
		));
		const handler = (await import(routePath)).default;
		const event = stubH3Event();

		await expect(handler(event)).rejects.toMatchObject({
			statusCode: 503,
			message: 'Graphics capacity is temporarily unavailable',
		});
		expect(mockSetResponseHeader).toHaveBeenCalledWith(event, 'retry-after', 5);
	});

	it('rejects the read before touching the library when no author session is authenticated', async () => {
		mockRequireGraphicsAuthorSession.mockRejectedValue(
			Object.assign(new Error('authenticated session required'), { statusCode: 401 }),
		);
		const handler = (await import(routePath)).default;

		await expect(handler(stubH3Event())).rejects.toMatchObject({ statusCode: 401 });
		expect(mockGetCapacity).not.toHaveBeenCalled();
	});
});
