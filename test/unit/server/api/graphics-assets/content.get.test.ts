import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubH3Event } from '~~/test/helpers/h3Event';

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
vi.stubGlobal('getRequestHeader', vi.fn((event: { headers?: Record<string, string> }, name: string) =>
	event.headers?.[name]));

function eventWithHeaders(headers: Record<string, string>) {
	return stubH3Event({ headers });
}
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

		await expect(handler(stubH3Event())).rejects.toMatchObject({ statusCode: 401 });
		expect(mockResolveGraphicAssetRevision).not.toHaveBeenCalled();
	});

	it('serves the complete revision with a validator and range support advertised', async () => {
		mockResolveGraphicAssetRevision.mockResolvedValue({
			outcome: 'available',
			body: new ReadableStream(),
			byteLength: 1000,
			contentType: 'video/webm',
		});
		const handler = (await import(
			'../../../../../server/api/graphics-assets/[assetId]/revisions/[revisionId]/content.get',
		)).default;

		const response = await handler(eventWithHeaders({})) as Response;

		expect(response.status).toBe(200);
		expect(response.headers.get('accept-ranges')).toBe('bytes');
		expect(response.headers.get('etag')).toBe('"sk-revision-asset-1-revision-1"');
		expect(response.headers.get('content-length')).toBe('1000');
		expect(response.headers.get('cache-control')).toBe('private, max-age=0, must-revalidate');
		expect(mockResolveGraphicAssetRevision).toHaveBeenCalledWith(
			expect.not.objectContaining({ range: expect.anything() }),
		);
	});

	it('answers a matching conditional read with 304 and no body resolution', async () => {
		const handler = (await import(
			'../../../../../server/api/graphics-assets/[assetId]/revisions/[revisionId]/content.get',
		)).default;

		const response = await handler(eventWithHeaders({
			'if-none-match': '"sk-revision-asset-1-revision-1"',
		})) as Response;

		expect(response.status).toBe(304);
		expect(response.headers.get('etag')).toBe('"sk-revision-asset-1-revision-1"');
		expect(mockResolveGraphicAssetRevision).not.toHaveBeenCalled();
	});

	it('serves an exact byte range as 206 with a content-range header', async () => {
		mockResolveGraphicAssetRevision.mockImplementation(async () => ({
			outcome: 'available',
			body: new ReadableStream(),
			byteLength: 1000,
			contentType: 'video/webm',
		}));
		const handler = (await import(
			'../../../../../server/api/graphics-assets/[assetId]/revisions/[revisionId]/content.get',
		)).default;

		const response = await handler(eventWithHeaders({ range: 'bytes=100-199' })) as Response;

		expect(response.status).toBe(206);
		expect(response.headers.get('content-range')).toBe('bytes 100-199/1000');
		expect(response.headers.get('content-length')).toBe('100');
		expect(mockResolveGraphicAssetRevision).toHaveBeenLastCalledWith(
			expect.objectContaining({ range: { offset: 100, length: 100 } }),
		);
	});

	it('rejects an unsatisfiable range with 416 and the complete length', async () => {
		mockResolveGraphicAssetRevision.mockResolvedValue({
			outcome: 'available',
			body: new ReadableStream(),
			byteLength: 1000,
			contentType: 'video/webm',
		});
		const handler = (await import(
			'../../../../../server/api/graphics-assets/[assetId]/revisions/[revisionId]/content.get',
		)).default;

		const response = await handler(eventWithHeaders({ range: 'bytes=5000-' })) as Response;

		expect(response.status).toBe(416);
		expect(response.headers.get('content-range')).toBe('bytes */1000');
	});

	it('ignores the range when an if-range validator does not match', async () => {
		mockResolveGraphicAssetRevision.mockResolvedValue({
			outcome: 'available',
			body: new ReadableStream(),
			byteLength: 1000,
			contentType: 'video/webm',
		});
		const handler = (await import(
			'../../../../../server/api/graphics-assets/[assetId]/revisions/[revisionId]/content.get',
		)).default;

		const response = await handler(eventWithHeaders({
			'range': 'bytes=0-99',
			'if-range': '"some-other-validator"',
		})) as Response;

		expect(response.status).toBe(200);
		expect(mockResolveGraphicAssetRevision).toHaveBeenLastCalledWith(
			expect.not.objectContaining({ range: expect.anything() }),
		);
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

		await expect(handler(stubH3Event())).rejects.toMatchObject({
			statusCode: 503,
			message: 'catalogue unavailable',
		});
		expect(mockSetResponseHeader).toHaveBeenCalledWith({}, 'retry-after', 5);
	});
});
