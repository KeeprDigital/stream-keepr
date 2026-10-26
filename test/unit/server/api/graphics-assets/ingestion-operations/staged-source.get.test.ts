import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { refusalFrom } from '~~/test/helpers/publicServerFailure';

const {
	mockRequireUserId,
	mockResolveStagedGraphicAssetSource,
	mockSetResponseHeader,
	mockRouterParam,
} = vi.hoisted(() => ({
	mockRequireUserId: vi.fn(),
	mockResolveStagedGraphicAssetSource: vi.fn(),
	mockSetResponseHeader: vi.fn(),
	mockRouterParam: vi.fn(),
}));

vi.mock('~~/server/utils/auth', () => ({
	requireUserId: mockRequireUserId,
}));

vi.mock('~~/server/modules/graphics-asset-library/runtime', () => ({
	graphicsAssetLibraryForEvent: () => ({
		resolveStagedGraphicAssetSource: mockResolveStagedGraphicAssetSource,
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

const routePath = '../../../../../../server/api/graphics-assets/ingestion-operations/[operationId]/staged-source.get';

// The staged bytes an author reads back for evidence, and the sentence they get when the
// staging store cannot produce them (#321).
describe('staged Graphic Asset source delivery', () => {
	beforeEach(() => {
		vi.resetModules();
		mockRequireUserId.mockReset().mockResolvedValue('author-1');
		mockResolveStagedGraphicAssetSource.mockReset();
		mockSetResponseHeader.mockReset();
		mockRouterParam.mockReset().mockReturnValue('operation-1');
	});

	it('serves the staged bytes privately and uncacheably, scoped to the asking author', async () => {
		mockResolveStagedGraphicAssetSource.mockResolvedValue({
			outcome: 'available',
			body: new ReadableStream(),
			byteLength: 2048,
		});
		const handler = (await import(routePath)).default;

		const response = await handler(stubH3Event()) as Response;

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('application/octet-stream');
		expect(response.headers.get('content-length')).toBe('2048');
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(response.headers.get('vary')).toBe('cookie');
		expect(mockResolveStagedGraphicAssetSource).toHaveBeenCalledWith({
			operationId: 'operation-1',
			initiatedBy: 'author-1',
		});
	});

	it('answers an operation awaiting nothing with 404', async () => {
		mockResolveStagedGraphicAssetSource.mockResolvedValue({ outcome: 'missing' });
		const handler = (await import(routePath)).default;

		await expect(handler(stubH3Event())).rejects.toMatchObject({
			statusCode: 404,
			message: 'No staged Graphic Asset source is awaiting confirmation',
		});
	});

	// After the mapper, which is where the sentence would be lost.
	it('says what is unavailable when the staging store cannot produce the bytes', async () => {
		mockResolveStagedGraphicAssetSource.mockResolvedValue({ outcome: 'unavailable' });
		const handler = (await import(routePath)).default;
		const event = stubH3Event();

		const failure = await refusalFrom(handler(event));

		expect(failure).toMatchObject({
			statusCode: 503,
			statusMessage: 'Service Unavailable',
			message: 'Staged Graphic Asset source bytes are temporarily unavailable',
		});
		expect(mockSetResponseHeader).toHaveBeenCalledWith(event, 'retry-after', 5);
	});
});
