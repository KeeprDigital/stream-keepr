import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubH3Event } from '~~/test/helpers/h3Event';

const {
	mockRequireGraphicsAuthorSession,
	mockInspectGraphicAssetRevision,
	mockSetResponseHeader,
	mockRouterParam,
} = vi.hoisted(() => ({
	mockRequireGraphicsAuthorSession: vi.fn(),
	mockInspectGraphicAssetRevision: vi.fn(),
	mockSetResponseHeader: vi.fn(),
	mockRouterParam: vi.fn(),
}));

vi.mock('~~/server/modules/graphics-author-session', () => ({
	requireGraphicsAuthorSession: mockRequireGraphicsAuthorSession,
}));

vi.mock('~~/server/modules/graphics-asset-library/runtime', () => ({
	graphicsAssetLibraryForEvent: () => ({
		inspectGraphicAssetRevision: mockInspectGraphicAssetRevision,
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

const routePath = '../../../../../server/api/graphics-assets/[assetId]/revisions/[revisionId]/status.get';

describe('graphic Asset Revision status', () => {
	beforeEach(() => {
		vi.resetModules();
		mockRequireGraphicsAuthorSession.mockReset().mockResolvedValue('author-1');
		mockInspectGraphicAssetRevision.mockReset().mockResolvedValue({ outcome: 'missing' });
		mockSetResponseHeader.mockReset();
		mockRouterParam.mockReset().mockImplementation((_event, name: string) =>
			name === 'assetId' ? 'asset-1' : 'revision-1');
	});

	it('maps a retryable catalogue failure to 503 with retry guidance', async () => {
		const { GraphicsAssetLibraryError } = await import('~~/server/modules/graphics-asset-library');
		mockInspectGraphicAssetRevision.mockRejectedValue(new GraphicsAssetLibraryError(
			'Graphic Asset Revision lookup is temporarily unavailable',
			'graphics-asset-library-unavailable',
		));
		const handler = (await import(routePath)).default;
		const event = stubH3Event();

		await expect(handler(event)).rejects.toMatchObject({
			statusCode: 503,
			message: 'Graphic Asset Revision lookup is temporarily unavailable',
		});
		expect(mockSetResponseHeader).toHaveBeenCalledWith(event, 'retry-after', 5);
	});

	it('answers a blank revision segment with 400 rather than an unclassified failure', async () => {
		mockRouterParam.mockImplementation((_event, name: string) =>
			name === 'assetId' ? 'asset-1' : '');
		const handler = (await import(routePath)).default;

		await expect(handler(stubH3Event())).rejects.toMatchObject({
			statusCode: 400,
			message: 'Graphic Asset Revision identity cannot be empty',
		});
		expect(mockInspectGraphicAssetRevision).not.toHaveBeenCalled();
	});

	it('inspects the revision the route names', async () => {
		mockInspectGraphicAssetRevision.mockResolvedValue({ outcome: 'available', kind: 'still-image' });
		const handler = (await import(routePath)).default;

		await handler(stubH3Event());

		expect(mockInspectGraphicAssetRevision).toHaveBeenCalledWith({
			assetId: 'asset-1',
			revisionId: 'revision-1',
		});
	});
});
