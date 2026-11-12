import type { SqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGraphicsAssetLibrary } from '~~/server/modules/graphics-asset-library';
import { createD1GraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library/catalogue';
import {
	createInMemoryCanonicalGraphicsObjectStore,
	createInMemoryStagingGraphicsObjectStore,
} from '~~/server/modules/graphics-asset-library/in-memory-object-store';
import {
	DEFAULT_GRAPHICS_CANONICAL_QUOTA_BYTES,
	DEFAULT_GRAPHICS_STAGING_ALLOWANCE_BYTES,
} from '~~/shared/types/graphicsAsset';
import { pixelPng as transparentPixelPng } from '~~/test/helpers/graphicsFixtures';
import { boundedBytes } from '~~/test/helpers/graphicsLibrary';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

let harness: SqliteD1Harness;

beforeEach(async () => {
	harness = await createSqliteD1Harness();
});

afterEach(async () => {
	await harness.close();
});

describe('the Graphics Asset Library Capacity', () => {
	const browserDecodeEvidence = (bytes: Uint8Array) => ({
		outcome: 'decoded' as const,
		sourceDigest: createHash('sha256').update(bytes).digest('hex'),
		width: 1,
		height: 1,
	});

	it('reports the installation defaults and separate canonical usage categories', async () => {
		const library = createGraphicsAssetLibrary({
			catalogue: createD1GraphicsAssetCatalogue(harness.database),
			staging: createInMemoryStagingGraphicsObjectStore(),
			canonical: createInMemoryCanonicalGraphicsObjectStore(),
		});

		await expect(library.getCapacity()).resolves.toEqual({
			canonical: {
				limitBytes: DEFAULT_GRAPHICS_CANONICAL_QUOTA_BYTES,
				usedBytes: 0,
				reservedBytes: 0,
				availableBytes: DEFAULT_GRAPHICS_CANONICAL_QUOTA_BYTES,
				pressure: 'normal',
				breakdown: {
					retainedSourceBytes: 0,
					retainedDerivativeBytes: 0,
					metadataBytes: expect.any(Number),
					providerCacheBytes: 0,
					unreachableQuarantineBytes: 0,
				},
			},
			staging: {
				limitBytes: DEFAULT_GRAPHICS_STAGING_ALLOWANCE_BYTES,
				usedBytes: 0,
				reservedBytes: 0,
				availableBytes: DEFAULT_GRAPHICS_STAGING_ALLOWANCE_BYTES,
			},
		});
		expect((await library.getCapacity()).canonical.breakdown.metadataBytes).toBeGreaterThan(0);
	});

	it('accounts for catalogue metadata and unreachable canonical writes separately', async () => {
		const catalogue = createD1GraphicsAssetCatalogue(harness.database);
		const library = createGraphicsAssetLibrary({
			catalogue,
			staging: createInMemoryStagingGraphicsObjectStore(),
			canonical: createInMemoryCanonicalGraphicsObjectStore(),
		});
		const operation = await library.initiateGraphicsIngestion({
			idempotencyKey: 'unreachable-canonical-write',
			initiatedBy: 'graphics-author-1',
			name: 'Unreachable canonical write',
			declaredByteLength: transparentPixelPng.byteLength,
		});
		await catalogue.recordCanonicalWrites({
			operation,
			contents: [
				{ digest: 'unreachable-digest', byteLength: 123 },
			],
			recordedAt: operation.updatedAt,
		});
		await library.cancelGraphicsIngestion({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
		});

		await expect(library.getCapacity()).resolves.toMatchObject({
			canonical: {
				usedBytes: 0,
				breakdown: {
					metadataBytes: expect.any(Number),
					providerCacheBytes: 0,
					unreachableQuarantineBytes: 123,
				},
			},
		});
		expect((await library.getCapacity()).canonical.breakdown.metadataBytes).toBeGreaterThan(0);
	});

	it('reports warning pressure at 80% and critical pressure at 95%', async () => {
		const library = createGraphicsAssetLibrary({
			catalogue: createD1GraphicsAssetCatalogue(harness.database),
			staging: createInMemoryStagingGraphicsObjectStore(),
			canonical: createInMemoryCanonicalGraphicsObjectStore(),
		});
		const operation = await library.initiateGraphicsIngestion({
			idempotencyKey: 'capacity-pressure-source',
			initiatedBy: 'graphics-author-1',
			name: 'Capacity pressure source',
			browserDecodeEvidence: browserDecodeEvidence(transparentPixelPng),
			declaredByteLength: transparentPixelPng.byteLength,
		});
		await library.uploadGraphicAsset({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			bytes: boundedBytes(transparentPixelPng),
		});
		const usedBytes = (await library.getCapacity()).canonical.usedBytes;

		await library.updateCapacityLimits({
			canonicalLimitBytes: Math.floor(usedBytes / 0.8),
			stagingLimitBytes: DEFAULT_GRAPHICS_STAGING_ALLOWANCE_BYTES,
		});
		expect((await library.getCapacity()).canonical.pressure).toBe('warning');

		await library.updateCapacityLimits({
			canonicalLimitBytes: Math.floor(usedBytes / 0.95),
			stagingLimitBytes: DEFAULT_GRAPHICS_STAGING_ALLOWANCE_BYTES,
		});
		expect((await library.getCapacity()).canonical.pressure).toBe('critical');
	});
});
