import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubH3Event } from '~~/test/helpers/h3Event';

const {
	mockRequireUserId,
	mockListGraphicAssetUsage,
	mockSetResponseHeader,
	mockRouterParam,
} = vi.hoisted(() => ({
	mockRequireUserId: vi.fn(),
	mockListGraphicAssetUsage: vi.fn(),
	mockSetResponseHeader: vi.fn(),
	mockRouterParam: vi.fn(),
}));

vi.mock('~~/server/utils/auth', () => ({
	requireUserId: mockRequireUserId,
}));

vi.mock('~~/server/modules/graphics-asset-library/runtime', () => ({
	graphicsAssetLibraryForEvent: () => ({
		listGraphicAssetUsage: mockListGraphicAssetUsage,
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

const routePath = '../../../../../server/api/graphics-assets/[assetId]/usage.get';

describe('graphic Asset usage discovery', () => {
	beforeEach(() => {
		vi.resetModules();
		mockRequireUserId.mockReset().mockResolvedValue('author-1');
		mockListGraphicAssetUsage.mockReset().mockResolvedValue([]);
		mockSetResponseHeader.mockReset();
		mockRouterParam.mockReset().mockReturnValue('asset-1');
	});

	it('maps a retryable catalogue failure to 503 with retry guidance', async () => {
		const { GraphicsAssetLibraryError } = await import('~~/server/modules/graphics-asset-library');
		mockListGraphicAssetUsage.mockRejectedValue(new GraphicsAssetLibraryError(
			'Graphic Asset usage is temporarily unavailable',
			'graphics-asset-library-unavailable',
		));
		const handler = (await import(routePath)).default;
		const event = stubH3Event();

		await expect(handler(event)).rejects.toMatchObject({
			statusCode: 503,
			message: 'Graphic Asset usage is temporarily unavailable',
		});
		expect(mockSetResponseHeader).toHaveBeenCalledWith(event, 'retry-after', 5);
	});

	it('rejects the read before touching the library when no author session is authenticated', async () => {
		mockRequireUserId.mockRejectedValue(
			Object.assign(new Error('authenticated session required'), { statusCode: 401 }),
		);
		const handler = (await import(routePath)).default;

		await expect(handler(stubH3Event())).rejects.toMatchObject({ statusCode: 401 });
		expect(mockListGraphicAssetUsage).not.toHaveBeenCalled();
	});
});
