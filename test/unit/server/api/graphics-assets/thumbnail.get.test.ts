import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubH3Event } from '~~/test/helpers/h3Event';

const {
	mockRequireGraphicsAuthorSession,
	mockResolveGraphicAssetThumbnail,
	mockSetResponseHeader,
	mockRouterParam,
} = vi.hoisted(() => ({
	mockRequireGraphicsAuthorSession: vi.fn(),
	mockResolveGraphicAssetThumbnail: vi.fn(),
	mockSetResponseHeader: vi.fn(),
	mockRouterParam: vi.fn(),
}));

vi.mock('~~/server/modules/graphics-author-session', () => ({
	requireGraphicsAuthorSession: mockRequireGraphicsAuthorSession,
}));

vi.mock('~~/server/modules/graphics-asset-library/runtime', () => ({
	graphicsAssetLibraryForEvent: () => ({
		resolveGraphicAssetThumbnail: mockResolveGraphicAssetThumbnail,
	}),
}));

vi.stubGlobal('defineEventHandler', vi.fn(handler => handler));
vi.stubGlobal('getRouterParam', mockRouterParam);
vi.stubGlobal('setResponseHeader', mockSetResponseHeader);
vi.stubGlobal('createError', (input: {
	statusCode: number;
	statusMessage?: string;
	message: string;
	cause?: unknown;
}) => Object.assign(new Error(input.message), input));

const routePath = '../../../../../server/api/graphics-assets/[assetId]/thumbnail.get';

describe('graphic Asset thumbnail delivery', () => {
	beforeEach(() => {
		vi.resetModules();
		mockRequireGraphicsAuthorSession.mockReset().mockResolvedValue('author-1');
		mockResolveGraphicAssetThumbnail.mockReset();
		mockSetResponseHeader.mockReset();
		mockRouterParam.mockReset().mockReturnValue('asset-1');
	});

	it('serves recorded preview bytes as a private, uncacheable image', async () => {
		mockResolveGraphicAssetThumbnail.mockResolvedValue({
			outcome: 'available',
			body: new ReadableStream(),
			byteLength: 42,
			contentType: 'image/png',
		});
		const handler = (await import(routePath)).default;

		const response = await handler(stubH3Event()) as Response;

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('image/png');
		expect(response.headers.get('content-length')).toBe('42');
		expect(response.headers.get('cache-control')).toBe('private, no-store');
	});

	it('answers an asset with no recorded preview with 404, which the error wrapper leaves alone', async () => {
		mockResolveGraphicAssetThumbnail.mockResolvedValue({ outcome: 'missing' });
		const handler = (await import(routePath)).default;

		await expect(handler(stubH3Event())).rejects.toMatchObject({
			statusCode: 404,
			message: 'Graphic Asset thumbnail not found',
		});
	});

	it('answers a preview the store cannot produce with 503 and retry guidance', async () => {
		mockResolveGraphicAssetThumbnail.mockResolvedValue({ outcome: 'unavailable', retryable: true });
		const handler = (await import(routePath)).default;
		const event = stubH3Event();

		await expect(handler(event)).rejects.toMatchObject({ statusCode: 503 });
		expect(mockSetResponseHeader).toHaveBeenCalledWith(event, 'retry-after', 5);
	});

	it('answers a blank asset segment with 400 rather than an unclassified failure', async () => {
		mockRouterParam.mockReturnValue('');
		const handler = (await import(routePath)).default;

		await expect(handler(stubH3Event())).rejects.toMatchObject({
			statusCode: 400,
			message: 'Graphic Asset identity cannot be empty',
		});
		expect(mockResolveGraphicAssetThumbnail).not.toHaveBeenCalled();
	});

	it('maps a retryable catalogue failure to 503 with retry guidance', async () => {
		const { GraphicsAssetLibraryError } = await import('~~/server/modules/graphics-asset-library');
		mockResolveGraphicAssetThumbnail.mockRejectedValue(new GraphicsAssetLibraryError(
			'Graphic Asset preview lookup is temporarily unavailable',
			'graphics-asset-library-unavailable',
		));
		const handler = (await import(routePath)).default;
		const event = stubH3Event();

		await expect(handler(event)).rejects.toMatchObject({
			statusCode: 503,
			message: 'Graphic Asset preview lookup is temporarily unavailable',
		});
		expect(mockSetResponseHeader).toHaveBeenCalledWith(event, 'retry-after', 5);
	});

	it('rejects the read before touching the library when no author session is authenticated', async () => {
		mockRequireGraphicsAuthorSession.mockRejectedValue(
			Object.assign(new Error('authenticated session required'), { statusCode: 401 }),
		);
		const handler = (await import(routePath)).default;

		await expect(handler(stubH3Event())).rejects.toMatchObject({ statusCode: 401 });
		expect(mockResolveGraphicAssetThumbnail).not.toHaveBeenCalled();
	});
});
