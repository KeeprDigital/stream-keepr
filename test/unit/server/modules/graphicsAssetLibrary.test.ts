import { describe, expect, it, vi } from 'vitest';
import {
	createGraphicsAssetLibrary,
	graphicAssetId,
	graphicAssetRevisionId,
	GraphicsAssetLibraryError,
	graphicsDerivativeId,
	graphicsIngestionOperationId,
	installedGraphicsTemplateId,
} from '~~/server/modules/graphics-asset-library';
import {
	graphicsObjectIdentity,
	GraphicsObjectInputError,
} from '~~/server/modules/graphics-asset-library/object-store';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';
import { stubH3Event } from '~~/test/helpers/h3Event';

// The API boundary imports the asking user for its actor resolution, which builds the
// Better Auth instance over `~~/server/db` — a binding no unit run has. Nothing here asks it
// anything.
vi.mock('~~/server/utils/auth', () => ({
	optionalUserId: vi.fn(),
}));

vi.stubGlobal('createError', (input: { statusCode: number; message: string; cause?: unknown }) =>
	Object.assign(new Error(input.message), input));

describe('the Graphics Asset Library public module', () => {
	it('reports catalogue, staging, and canonical health as separate domain results', async () => {
		const catalogue = {
			checkHealth: vi.fn().mockResolvedValue({ outcome: 'healthy' }),
		};
		const staging = {
			checkHealth: vi.fn().mockResolvedValue({ outcome: 'healthy' }),
		};
		const canonical = {
			checkHealth: vi.fn().mockResolvedValue({ outcome: 'healthy' }),
		};
		const library = createGraphicsAssetLibrary({
			catalogue,
			staging,
			canonical,
			now: () => new Date('2026-07-27T04:00:00.000Z'),
		});

		await expect(library.getHealth()).resolves.toEqual({
			status: 'healthy',
			checkedAt: '2026-07-27T04:00:00.000Z',
			catalogue: { status: 'healthy' },
			byteStores: {
				staging: { status: 'healthy' },
				canonical: { status: 'healthy' },
			},
		});
		expect(catalogue.checkHealth).toHaveBeenCalledOnce();
		expect(staging.checkHealth).toHaveBeenCalledOnce();
		expect(canonical.checkHealth).toHaveBeenCalledOnce();
	});

	it('keeps checking every component and returns retryable structured degradation', async () => {
		const catalogue = {
			checkHealth: vi.fn().mockRejectedValue(new Error('D1 unavailable')),
		};
		const staging = {
			checkHealth: vi.fn().mockResolvedValue({
				outcome: 'unavailable',
				reason: { code: 'transient-object-store-failure', retryable: true },
			}),
		};
		const canonical = {
			checkHealth: vi.fn().mockResolvedValue({ outcome: 'healthy' }),
		};
		const library = createGraphicsAssetLibrary({
			catalogue,
			staging,
			canonical,
			now: () => new Date('2026-07-27T04:00:00.000Z'),
		});

		await expect(library.getHealth()).resolves.toEqual({
			status: 'degraded',
			checkedAt: '2026-07-27T04:00:00.000Z',
			catalogue: {
				status: 'unavailable',
				reason: { code: 'catalogue-unavailable', retryable: true },
			},
			byteStores: {
				staging: {
					status: 'unavailable',
					reason: { code: 'byte-store-unavailable', retryable: true },
				},
				canonical: { status: 'healthy' },
			},
		});
		expect(canonical.checkHealth).toHaveBeenCalledOnce();
	});

	describe.each([
		graphicAssetId,
		graphicAssetRevisionId,
		graphicsIngestionOperationId,
		graphicsDerivativeId,
		installedGraphicsTemplateId,
	])('the %o identity minter', (mint) => {
		// Refused as invalid input (400), never minted into a lookup that misses (404) (#322).
		it.each(['', '   ', '\t', ' \t\n '])('refuses %j as invalid input', (blank) => {
			expect(() => mint(blank)).toThrow(GraphicsAssetLibraryError);
			expect(() => mint(blank)).toThrow(expect.objectContaining({ code: 'invalid-ingestion-input' }));
		});

		it('mints the trimmed identity, so a padded segment addresses what it names', () => {
			expect(mint('\tid-1\n ')).toBe('id-1');
		});
	});
});

describe('the graphics object identity boundary', () => {
	it('refuses a blank object identity in a way the graphics asset API boundary answers 400', () => {
		const thrown = (() => {
			try {
				graphicsObjectIdentity('');
				return undefined;
			}
			catch (error) {
				return error;
			}
		})();

		expect(thrown).toBeInstanceOf(GraphicsObjectInputError);

		expect(() => rethrowGraphicsAssetApiError(thrown, stubH3Event())).toThrow(expect.objectContaining({
			statusCode: 400,
			message: 'A graphics object identity cannot be empty',
		}));
	});
});
