import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubH3Event } from '~~/test/helpers/h3Event';

const {
	mockRequireGraphicsAuthorSession,
	mockListGraphicAssets,
	mockSetResponseHeader,
} = vi.hoisted(() => ({
	mockRequireGraphicsAuthorSession: vi.fn(),
	mockListGraphicAssets: vi.fn(),
	mockSetResponseHeader: vi.fn(),
}));

vi.mock('~~/server/modules/graphics-author-session', () => ({
	requireGraphicsAuthorSession: mockRequireGraphicsAuthorSession,
}));

vi.mock('~~/server/modules/graphics-asset-library/runtime', () => ({
	graphicsAssetLibraryForEvent: () => ({
		listGraphicAssets: mockListGraphicAssets,
	}),
}));

vi.stubGlobal('defineEventHandler', vi.fn(handler => handler));
vi.stubGlobal('setResponseHeader', mockSetResponseHeader);
vi.stubGlobal('getValidatedQuery', vi.fn(async (
	event: { query?: Record<string, unknown> },
	validate: (input: unknown) => unknown,
) => validate(event.query ?? {})));
vi.stubGlobal('createError', (input: {
	statusCode: number;
	statusMessage?: string;
	message: string;
	cause?: unknown;
}) => Object.assign(new Error(input.message), input));

function eventWithQuery(query: Record<string, unknown> = {}) {
	return stubH3Event({ query });
}

describe('graphics Asset Library discovery', () => {
	beforeEach(() => {
		vi.resetModules();
		mockRequireGraphicsAuthorSession.mockReset().mockResolvedValue('author-1');
		mockListGraphicAssets.mockReset().mockResolvedValue([]);
		mockSetResponseHeader.mockReset();
	});

	it('rejects discovery before touching the library when no author session is authenticated', async () => {
		mockRequireGraphicsAuthorSession.mockRejectedValue(
			Object.assign(new Error('authenticated session required'), { statusCode: 401 }),
		);
		const handler = (await import('../../../../../server/api/graphics-assets/index.get')).default;

		await expect(handler(eventWithQuery())).rejects.toMatchObject({ statusCode: 401 });
		expect(mockListGraphicAssets).not.toHaveBeenCalled();
	});

	it('asks the library for the validated filter rather than a cast one', async () => {
		const handler = (await import('../../../../../server/api/graphics-assets/index.get')).default;

		await handler(eventWithQuery({ search: 'ident', lifecycleStates: 'retired,trashed' }));

		expect(mockListGraphicAssets).toHaveBeenCalledWith({
			search: 'ident',
			lifecycleStates: ['retired', 'trashed'],
		});
	});

	it('refuses a lifecycle state the library does not have', async () => {
		const handler = (await import('../../../../../server/api/graphics-assets/index.get')).default;

		await expect(handler(eventWithQuery({ lifecycleStates: 'bogus' }))).rejects.toThrow();
		expect(mockListGraphicAssets).not.toHaveBeenCalled();
	});

	it('maps a retryable catalogue failure to 503 with retry guidance', async () => {
		const { GraphicsAssetLibraryError } = await import('~~/server/modules/graphics-asset-library');
		mockListGraphicAssets.mockRejectedValue(new GraphicsAssetLibraryError(
			'Graphic Asset discovery is temporarily unavailable',
			'graphics-asset-library-unavailable',
		));
		const handler = (await import('../../../../../server/api/graphics-assets/index.get')).default;
		const event = eventWithQuery();

		await expect(handler(event)).rejects.toMatchObject({
			statusCode: 503,
			message: 'Graphic Asset discovery is temporarily unavailable',
		});
		expect(mockSetResponseHeader).toHaveBeenCalledWith(event, 'retry-after', 5);
	});
});
