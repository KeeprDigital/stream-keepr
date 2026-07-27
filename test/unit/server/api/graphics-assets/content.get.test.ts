import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	mockRequireGraphicsAuthorSession,
	mockResolveGraphicAssetRevision,
	mockSetResponseHeader,
} = vi.hoisted(() => ({
	mockRequireGraphicsAuthorSession: vi.fn(),
	mockResolveGraphicAssetRevision: vi.fn(),
	mockSetResponseHeader: vi.fn(),
}));

vi.mock('~~/server/modules/graphics-author-session', () => ({
	requireGraphicsAuthorSession: mockRequireGraphicsAuthorSession,
}));

vi.mock('~~/server/modules/graphics-asset-library/runtime', () => ({
	graphicsAssetLibraryForEvent: () => ({
		resolveGraphicAssetRevision: mockResolveGraphicAssetRevision,
	}),
}));

vi.stubGlobal('defineEventHandler', vi.fn(handler => handler));
vi.stubGlobal('getRouterParam', vi.fn((_event, name: string) =>
	name === 'assetId' ? 'asset-1' : 'revision-1'));
vi.stubGlobal('setResponseHeader', mockSetResponseHeader);
vi.stubGlobal('createError', (input: {
	statusCode: number;
	statusMessage?: string;
	message: string;
	cause?: unknown;
}) => Object.assign(new Error(input.message), input));

describe('authenticated exact Graphic Asset Revision content delivery', () => {
	beforeEach(() => {
		vi.resetModules();
		mockRequireGraphicsAuthorSession.mockReset().mockResolvedValue('author-1');
		mockResolveGraphicAssetRevision.mockReset();
		mockSetResponseHeader.mockReset();
	});

	it('rejects resolution before touching the library when no editor session is authenticated', async () => {
		mockRequireGraphicsAuthorSession.mockRejectedValue(
			Object.assign(new Error('authenticated session required'), { statusCode: 401 }),
		);
		const handler = (await import(
			'../../../../../server/api/graphics-assets/[assetId]/revisions/[revisionId]/content.get',
		)).default;

		await expect(handler({})).rejects.toMatchObject({ statusCode: 401 });
		expect(mockResolveGraphicAssetRevision).not.toHaveBeenCalled();
	});

	it('maps a retryable catalogue failure to 503 with retry guidance', async () => {
		const { GraphicsAssetLibraryError } = await import(
			'~~/server/modules/graphics-asset-library',
		);
		mockResolveGraphicAssetRevision.mockRejectedValue(
			new GraphicsAssetLibraryError(
				'catalogue unavailable',
				'graphics-asset-library-unavailable',
			),
		);
		const handler = (await import(
			'../../../../../server/api/graphics-assets/[assetId]/revisions/[revisionId]/content.get',
		)).default;

		await expect(handler({})).rejects.toMatchObject({
			statusCode: 503,
			message: 'catalogue unavailable',
		});
		expect(mockSetResponseHeader).toHaveBeenCalledWith({}, 'retry-after', 5);
	});
});
