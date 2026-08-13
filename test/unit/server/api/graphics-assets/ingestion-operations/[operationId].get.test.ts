import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubH3Event } from '~~/test/helpers/h3Event';

const {
	mockRequireGraphicsAuthorSession,
	mockGetIngestionOperation,
	mockSetResponseHeader,
	mockRouterParam,
} = vi.hoisted(() => ({
	mockRequireGraphicsAuthorSession: vi.fn(),
	mockGetIngestionOperation: vi.fn(),
	mockSetResponseHeader: vi.fn(),
	mockRouterParam: vi.fn(),
}));

vi.mock('~~/server/modules/graphics-author-session', () => ({
	requireGraphicsAuthorSession: mockRequireGraphicsAuthorSession,
}));

vi.mock('~~/server/modules/graphics-asset-library/runtime', () => ({
	graphicsAssetLibraryForEvent: () => ({
		getIngestionOperation: mockGetIngestionOperation,
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

const routePath = '../../../../../../server/api/graphics-assets/ingestion-operations/[operationId].get';

describe('one Graphics Ingestion Operation, as its initiator polls it', () => {
	beforeEach(() => {
		vi.resetModules();
		mockRequireGraphicsAuthorSession.mockReset().mockResolvedValue('author-1');
		mockGetIngestionOperation.mockReset().mockResolvedValue({ id: 'operation-1' });
		mockSetResponseHeader.mockReset();
		mockRouterParam.mockReset().mockReturnValue('operation-1');
	});

	it('maps a retryable operation read failure to 503 with retry guidance', async () => {
		const { GraphicsAssetLibraryError } = await import('~~/server/modules/graphics-asset-library');
		mockGetIngestionOperation.mockRejectedValue(new GraphicsAssetLibraryError(
			'Graphics Ingestion Operation lookup is temporarily unavailable',
			'graphics-asset-library-unavailable',
		));
		const handler = (await import(routePath)).default;
		const event = stubH3Event();

		await expect(handler(event)).rejects.toMatchObject({
			statusCode: 503,
			message: 'Graphics Ingestion Operation lookup is temporarily unavailable',
		});
		expect(mockSetResponseHeader).toHaveBeenCalledWith(event, 'retry-after', 5);
	});

	it('answers a blank operation segment with 400 rather than an unclassified failure', async () => {
		mockRouterParam.mockReturnValue('');
		const handler = (await import(routePath)).default;

		await expect(handler(stubH3Event())).rejects.toMatchObject({
			statusCode: 400,
			message: 'Graphics Ingestion Operation identity cannot be empty',
		});
		expect(mockGetIngestionOperation).not.toHaveBeenCalled();
	});
});
