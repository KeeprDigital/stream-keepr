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
		const catalogue = { checkHealth: vi.fn().mockResolvedValue({ outcome: 'healthy' }) };
		const staging = { checkHealth: vi.fn().mockResolvedValue({ outcome: 'healthy' }) };
		const canonical = { checkHealth: vi.fn().mockResolvedValue({ outcome: 'healthy' }) };
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
		const catalogue = { checkHealth: vi.fn().mockRejectedValue(new Error('D1 unavailable')) };
		const staging = {
			checkHealth: vi.fn().mockResolvedValue({
				outcome: 'unavailable',
				reason: { code: 'transient-object-store-failure', retryable: true },
			}),
		};
		const canonical = { checkHealth: vi.fn().mockResolvedValue({ outcome: 'healthy' }) };
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

	it('constructs opaque Graphic Asset domain identities at the boundary', () => {
		expect(graphicAssetId('asset-1')).toBe('asset-1');
		expect(graphicAssetRevisionId('revision-1')).toBe('revision-1');
		expect(graphicsIngestionOperationId('operation-1')).toBe('operation-1');
		expect(() => graphicAssetId('')).toThrow('Graphic Asset identity cannot be empty');
	});

	it('classifies a blank identity as invalid input rather than an unclassified failure', () => {
		expect(() => graphicAssetId('')).toThrow(GraphicsAssetLibraryError);
		for (const mint of [graphicAssetId, graphicAssetRevisionId, graphicsIngestionOperationId]) {
			expect(() => mint('')).toThrow(expect.objectContaining({ code: 'invalid-ingestion-input' }));
		}
	});

	/**
	 * A path segment of nothing but spaces is a caller's malformed request, and #322
	 * found it minting a domain identity instead of being refused.
	 *
	 * The refusal these minters raise is answered 400 by `rethrowGraphicsAssetApiError`,
	 * and a lookup miss is answered 404 — so an untrimmed guard did not merely word the
	 * failure differently, it told the caller its request was fine and the asset was
	 * gone. Both neighbouring minters, `requiredActor` and `graphicsDiscrepancyId`,
	 * trimmed before testing; these five were the ones that did not.
	 */
	it('refuses an identity that is only whitespace, as its neighbours already did', () => {
		const minters = [
			graphicAssetId,
			graphicAssetRevisionId,
			graphicsIngestionOperationId,
			graphicsDerivativeId,
			installedGraphicsTemplateId,
		];
		expect(minters).toHaveLength(5);

		for (const mint of minters) {
			for (const blank of ['   ', '\t', '\n', ' \t\n ']) {
				expect(() => mint(blank)).toThrow(expect.objectContaining({ code: 'invalid-ingestion-input' }));
			}
		}
	});

	it('mints the trimmed identity, so a padded segment addresses what it names', () => {
		expect(graphicAssetId('  asset-1  ')).toBe('asset-1');
		expect(graphicAssetRevisionId('\trevision-1\n')).toBe('revision-1');
	});
});

/**
 * The object store's own boundary minter, which #322 found throwing a bare `Error`
 * while every sibling in the file threw `GraphicsObjectInputError`.
 *
 * The class is what `rethrowGraphicsAssetApiError` reads to answer 400; a bare `Error`
 * passes through it untouched and is sanitized into a 500. No route reaches this one
 * today — the #316/#317 review established that all ~20 call sites interpolate a fixed
 * prefix or read a persisted key — so this pins the classification rather than a
 * refusal anybody currently meets, and it is the sibling parity that makes the next
 * caller safe.
 */
describe('the graphics object identity boundary', () => {
	it('classifies a blank object identity the way its siblings in the file do', () => {
		expect(() => graphicsObjectIdentity('')).toThrow(GraphicsObjectInputError);
	});

	it('is answered 400 by the graphics asset API boundary', () => {
		const thrown = (() => {
			try {
				graphicsObjectIdentity('');
				return undefined;
			}
			catch (error) {
				return error;
			}
		})();

		expect(() => rethrowGraphicsAssetApiError(thrown, stubH3Event())).toThrow(expect.objectContaining({
			statusCode: 400,
			message: 'A graphics object identity cannot be empty',
		}));
	});

	it('mints a non-empty identity unchanged', () => {
		expect(graphicsObjectIdentity('canonical/asset-1/revision-1')).toBe('canonical/asset-1/revision-1');
	});
});
