import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubH3Event } from '~~/test/helpers/h3Event';

const {
	mockRequireGraphicsAuthorSession,
	mockUpdateGraphicAsset,
	mockSetResponseHeader,
	mockRouterParam,
	mockReadValidatedBody,
} = vi.hoisted(() => ({
	mockRequireGraphicsAuthorSession: vi.fn(),
	mockUpdateGraphicAsset: vi.fn(),
	mockSetResponseHeader: vi.fn(),
	mockRouterParam: vi.fn(),
	mockReadValidatedBody: vi.fn(),
}));

vi.mock('~~/server/modules/graphics-author-session', () => ({
	requireGraphicsAuthorSession: mockRequireGraphicsAuthorSession,
}));

vi.mock('~~/server/modules/graphics-asset-library/runtime', () => ({
	graphicsAssetLibraryForEvent: () => ({
		updateGraphicAsset: mockUpdateGraphicAsset,
	}),
}));

vi.stubGlobal('defineEventHandler', vi.fn(handler => handler));
vi.stubGlobal('getRouterParam', mockRouterParam);
vi.stubGlobal('setResponseHeader', mockSetResponseHeader);
vi.stubGlobal('readValidatedBody', mockReadValidatedBody);
vi.stubGlobal('createError', (input: {
	statusCode: number;
	statusMessage?: string;
	message: string;
	cause?: unknown;
}) => Object.assign(new Error(input.message), input));

const routePath = '../../../../../../server/api/graphics-assets/[assetId]/index.patch';

describe('graphic Asset metadata edits', () => {
	beforeEach(() => {
		vi.resetModules();
		mockRequireGraphicsAuthorSession.mockReset().mockResolvedValue('author-1');
		mockUpdateGraphicAsset.mockReset().mockResolvedValue({ id: 'asset-1' });
		mockSetResponseHeader.mockReset();
		mockRouterParam.mockReset().mockReturnValue('asset-1');
		mockReadValidatedBody.mockReset().mockResolvedValue({ name: 'Lower third', eventIds: [] });
	});

	it('maps a retryable catalogue failure to 503 with retry guidance', async () => {
		const { GraphicsAssetLibraryError } = await import('~~/server/modules/graphics-asset-library');
		mockUpdateGraphicAsset.mockRejectedValue(new GraphicsAssetLibraryError(
			'Graphic Asset metadata is temporarily unwritable',
			'graphics-asset-library-unavailable',
		));
		const handler = (await import(routePath)).default;
		const event = stubH3Event();

		await expect(handler(event)).rejects.toMatchObject({
			statusCode: 503,
			message: 'Graphic Asset metadata is temporarily unwritable',
		});
		expect(mockSetResponseHeader).toHaveBeenCalledWith(event, 'retry-after', 5);
	});

	it('rejects the edit before reading a body when no author session is authenticated', async () => {
		mockRequireGraphicsAuthorSession.mockRejectedValue(
			Object.assign(new Error('authenticated session required'), { statusCode: 401 }),
		);
		const handler = (await import(routePath)).default;

		await expect(handler(stubH3Event())).rejects.toMatchObject({ statusCode: 401 });
		expect(mockReadValidatedBody).not.toHaveBeenCalled();
		expect(mockUpdateGraphicAsset).not.toHaveBeenCalled();
	});
});
