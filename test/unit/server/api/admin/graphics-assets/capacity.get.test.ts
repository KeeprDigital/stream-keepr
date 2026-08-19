import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubH3Event } from '~~/test/helpers/h3Event';

const {
	mockRequireGraphicsAdministrator,
	mockGetCapacity,
	mockSetResponseHeader,
} = vi.hoisted(() => ({
	mockRequireGraphicsAdministrator: vi.fn(),
	mockGetCapacity: vi.fn(),
	mockSetResponseHeader: vi.fn(),
}));

vi.mock('~~/server/modules/graphics-administrator', () => ({
	requireGraphicsAdministrator: mockRequireGraphicsAdministrator,
}));

// The error wrapper reaches for the asking user when it names an actor, and that
// module builds the Better Auth instance over `hub:db` at import time. This route
// never names an actor, so the stub only keeps the import graph resolvable.
vi.mock('~~/server/utils/auth', () => ({
	optionalUserId: vi.fn().mockResolvedValue(undefined),
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

const routePath = '../../../../../../server/api/admin/graphics-assets/capacity.get';

describe('installation storage occupancy, as an administrator reads it', () => {
	beforeEach(() => {
		vi.resetModules();
		mockRequireGraphicsAdministrator.mockReset().mockResolvedValue(undefined);
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

	it('rejects the read before touching the library without the installation admin token', async () => {
		mockRequireGraphicsAdministrator.mockRejectedValue(
			Object.assign(new Error('administrator token required'), { statusCode: 401 }),
		);
		const handler = (await import(routePath)).default;

		await expect(handler(stubH3Event())).rejects.toMatchObject({ statusCode: 401 });
		expect(mockGetCapacity).not.toHaveBeenCalled();
	});
});
