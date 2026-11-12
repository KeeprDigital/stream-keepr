import type { SqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GraphicsAssetLibraryError } from '~~/server/modules/graphics-asset-library';
import { createD1GraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library/catalogue';
import { createInMemoryCanonicalGraphicsObjectStore } from '~~/server/modules/graphics-asset-library/in-memory-object-store';
import {
	graphicsObjectIdentity,
} from '~~/server/modules/graphics-asset-library/object-store';
import {
	DEFAULT_GRAPHICS_CANONICAL_QUOTA_BYTES,
	DEFAULT_GRAPHICS_STAGING_ALLOWANCE_BYTES,
} from '~~/shared/types/graphicsAsset';
import { pngWithTextChunks, pixelPng as transparentPixelPng } from '~~/test/helpers/graphicsFixtures';
import {
	boundedBytes,
	createTestGraphicsIngestion,
	setCapacityLimits,
	storedGraphicAssets,
} from '~~/test/helpers/graphicsLibrary';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

let harness: SqliteD1Harness;

beforeEach(async () => {
	harness = await createSqliteD1Harness();
});

afterEach(async () => {
	await harness.close();
});

type D1Catalogue = ReturnType<typeof createD1GraphicsAssetCatalogue>;

function createIngestion(options: {
	catalogue?: D1Catalogue;
	canonical?: ReturnType<typeof createInMemoryCanonicalGraphicsObjectStore>;
} = {}) {
	return createTestGraphicsIngestion({
		catalogue: createD1GraphicsAssetCatalogue(harness.database),
		...options,
	});
}

describe('the Graphics Asset Library Capacity at the Graphic Asset ingestion seam', () => {
	const browserDecodeEvidence = (bytes: Uint8Array) => ({
		outcome: 'decoded' as const,
		sourceDigest: createHash('sha256').update(bytes).digest('hex'),
		width: 1,
		height: 1,
	});

	it('admits concurrent staging work only while worst-case reservations fit', async () => {
		const context = createIngestion();
		const { ingestion } = context;
		await setCapacityLimits(context, {
			canonicalLimitBytes: DEFAULT_GRAPHICS_CANONICAL_QUOTA_BYTES,
			stagingLimitBytes: 68,
		});
		const admission = (idempotencyKey: string) => ingestion.initiateGraphicsIngestion({
			idempotencyKey,
			initiatedBy: 'graphics-author-1',
			name: idempotencyKey,
			declaredByteLength: 68,
		});

		const outcomes = await Promise.allSettled([
			admission('first'),
			admission('second'),
		]);
		const accepted = outcomes.find(
			(outcome): outcome is PromiseFulfilledResult<Awaited<ReturnType<typeof admission>>> =>
				outcome.status === 'fulfilled',
		);
		const rejected = outcomes.find(
			(outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
		);

		expect(accepted?.value.stage).toBe('created');
		expect(rejected?.reason).toBeInstanceOf(GraphicsAssetLibraryError);
		expect(rejected?.reason).toMatchObject({
			code: 'staging-capacity-exhausted',
			capacity: {
				resource: 'staging',
				limitBytes: 68,
				usedBytes: 0,
				reservedBytes: 68,
				requestedBytes: 68,
				availableBytes: 0,
			},
		});
		await expect(context.catalogue.getCapacity()).resolves.toMatchObject({
			staging: {
				usedBytes: 0,
				reservedBytes: 68,
				availableBytes: 0,
			},
		});

		await ingestion.cancelGraphicsIngestion({
			operationId: accepted!.value.id,
			initiatedBy: accepted!.value.initiatedBy,
		});
		await expect(context.catalogue.getCapacity()).resolves.toMatchObject({
			staging: {
				usedBytes: 0,
				reservedBytes: 0,
				availableBytes: 68,
			},
		});
	});

	it('moves verified staging progress from reserved to used capacity', async () => {
		const canonicalDelegate = createInMemoryCanonicalGraphicsObjectStore();
		let releaseCanonical!: () => void;
		let reportCanonicalStarted!: () => void;
		const canonicalGate = new Promise<void>(resolve => releaseCanonical = resolve);
		const canonicalStarted = new Promise<void>(resolve => reportCanonicalStarted = resolve);
		const canonical = {
			...canonicalDelegate,
			async createImmutable(input: Parameters<typeof canonicalDelegate.createImmutable>[0]) {
				reportCanonicalStarted();
				await canonicalGate;
				return await canonicalDelegate.createImmutable(input);
			},
		};
		const context = createIngestion({ canonical });
		const { ingestion } = context;
		await setCapacityLimits(context, {
			canonicalLimitBytes: DEFAULT_GRAPHICS_CANONICAL_QUOTA_BYTES,
			stagingLimitBytes: transparentPixelPng.byteLength,
		});
		const operation = await ingestion.initiateGraphicsIngestion({
			idempotencyKey: 'verified-staging-progress',
			initiatedBy: 'graphics-author-1',
			name: 'Verified staging progress',
			browserDecodeEvidence: browserDecodeEvidence(transparentPixelPng),
			declaredByteLength: transparentPixelPng.byteLength,
		});
		const upload = ingestion.uploadGraphicAsset({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			bytes: boundedBytes(transparentPixelPng),
		});

		await canonicalStarted;
		await expect(context.catalogue.getCapacity()).resolves.toMatchObject({
			staging: {
				usedBytes: transparentPixelPng.byteLength,
				reservedBytes: 0,
				availableBytes: 0,
			},
		});

		releaseCanonical();
		await expect(upload).resolves.toMatchObject({ stage: 'completed' });
		await expect(context.catalogue.getCapacity()).resolves.toMatchObject({
			staging: {
				usedBytes: 0,
				reservedBytes: 0,
				availableBytes: transparentPixelPng.byteLength,
			},
		});
	});

	it('blocks canonical growth before writing bytes when the hard limit is exhausted', async () => {
		const canonical = createInMemoryCanonicalGraphicsObjectStore();
		const context = createIngestion({ canonical });
		const { ingestion } = context;
		await setCapacityLimits(context, {
			canonicalLimitBytes: 1,
			stagingLimitBytes: DEFAULT_GRAPHICS_STAGING_ALLOWANCE_BYTES,
		});
		const operation = await ingestion.initiateGraphicsIngestion({
			idempotencyKey: 'blocked-canonical-growth',
			initiatedBy: 'graphics-author-1',
			name: 'Blocked canonical growth',
			browserDecodeEvidence: browserDecodeEvidence(transparentPixelPng),
			declaredByteLength: transparentPixelPng.byteLength,
		});

		const blocked = await ingestion.uploadGraphicAsset({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			bytes: boundedBytes(transparentPixelPng),
		});

		expect(blocked).toMatchObject({
			stage: 'failed',
			canonicalCapacityOutcome: {
				outcome: 'canonical-capacity-blocked',
				growthBytes: expect.any(Number),
				availableBytes: 1,
			},
			failure: {
				code: 'canonical-capacity-exhausted',
				retryable: true,
			},
		});
		expect(blocked.canonicalCapacityOutcome?.growthBytes).toBeGreaterThan(1);
		await expect(storedGraphicAssets(context)).resolves.toEqual([]);
		await expect(context.catalogue.getCapacity()).resolves.toMatchObject({
			canonical: {
				usedBytes: 0,
				reservedBytes: 0,
				availableBytes: 1,
			},
		});
		await expect(canonical.readMetadata(graphicsObjectIdentity(
			'sha256/431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460',
		))).resolves.toEqual({ outcome: 'missing' });
	});

	it('never answers a lost publication claim with exhausted capacity', async () => {
		const catalogue = createD1GraphicsAssetCatalogue(harness.database);
		let claimLost = false;
		const context = createIngestion({
			// A lost claim is a race between two attempts at one operation, so it
			// cannot be staged from outside. The reservation is where the catalogue
			// detects it, which is where it is handed to ingestion here.
			catalogue: new Proxy(catalogue, {
				get(target, property, receiver) {
					if (property === 'reserveGraphicAssetPublication' && claimLost)
						return async () => ({ outcome: 'lost-claim' as const });
					return Reflect.get(target, property, receiver);
				},
			}),
		});
		const { ingestion } = context;
		const operation = await ingestion.initiateGraphicsIngestion({
			idempotencyKey: 'lost-publication-claim',
			initiatedBy: 'graphics-author-1',
			name: 'Lost publication claim',
			browserDecodeEvidence: browserDecodeEvidence(transparentPixelPng),
			declaredByteLength: transparentPixelPng.byteLength,
		});
		claimLost = true;

		const answered = await ingestion.uploadGraphicAsset({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			bytes: boundedBytes(transparentPixelPng),
		});

		// The library holds nothing and its quota is untouched, so capacity was
		// never the condition: an author sent to free space would find nothing to
		// free. What comes back is the operation as it actually stands.
		expect(answered.failure).toBeUndefined();
		expect(answered.canonicalCapacityOutcome).toBeUndefined();
		expect(answered.stage).toBe('generating-derivatives');
		await expect(context.catalogue.getCapacity()).resolves.toMatchObject({
			canonical: { usedBytes: 0, reservedBytes: 0 },
		});
	});

	it('publishes proven no-growth content at the full Canonical Graphics Quota', async () => {
		const context = createIngestion();
		const { ingestion } = context;
		const upload = async (idempotencyKey: string) => {
			const operation = await ingestion.initiateGraphicsIngestion({
				idempotencyKey,
				initiatedBy: 'graphics-author-1',
				name: idempotencyKey,
				duplicateContentPolicy: 'create-separate',
				browserDecodeEvidence: browserDecodeEvidence(transparentPixelPng),
				declaredByteLength: transparentPixelPng.byteLength,
			});
			return await ingestion.uploadGraphicAsset({
				operationId: operation.id,
				initiatedBy: operation.initiatedBy,
				bytes: boundedBytes(transparentPixelPng),
			});
		};

		const first = await upload('first-canonical-copy');
		expect(first.canonicalCapacityOutcome).toMatchObject({
			outcome: 'canonical-growth-reserved',
			growthBytes: expect.any(Number),
		});
		const initialCapacity = await context.catalogue.getCapacity();
		expect(initialCapacity.canonical.breakdown.retainedSourceBytes)
			.toBe(transparentPixelPng.byteLength);
		expect(initialCapacity.canonical.breakdown.retainedDerivativeBytes)
			.toBeGreaterThan(0);
		expect(initialCapacity.canonical.usedBytes).toBe(
			initialCapacity.canonical.breakdown.retainedSourceBytes
			+ initialCapacity.canonical.breakdown.retainedDerivativeBytes,
		);

		await setCapacityLimits(context, {
			canonicalLimitBytes: initialCapacity.canonical.usedBytes,
			stagingLimitBytes: initialCapacity.staging.limitBytes,
		});
		await expect(context.catalogue.getCapacity()).resolves.toMatchObject({
			canonical: {
				pressure: 'full',
				availableBytes: 0,
			},
		});

		const noGrowth = await upload('second-canonical-copy');
		expect(noGrowth).toMatchObject({
			stage: 'completed',
			canonicalCapacityOutcome: {
				outcome: 'no-canonical-growth',
				growthBytes: 0,
				availableBytes: 0,
			},
			result: { outcome: 'published' },
		});
		await expect(context.catalogue.getCapacity()).resolves.toMatchObject({
			canonical: {
				usedBytes: initialCapacity.canonical.usedBytes,
				reservedBytes: 0,
				availableBytes: 0,
			},
		});
	});

	it('keeps concurrent canonical publication reservations within the hard limit', async () => {
		const context = createIngestion();
		const { ingestion } = context;
		const upload = async (idempotencyKey: string, bytes: Uint8Array) => {
			const operation = await ingestion.initiateGraphicsIngestion({
				idempotencyKey,
				initiatedBy: 'graphics-author-1',
				name: idempotencyKey,
				duplicateContentPolicy: 'create-separate',
				browserDecodeEvidence: browserDecodeEvidence(bytes),
				declaredByteLength: bytes.byteLength,
			});
			return await ingestion.uploadGraphicAsset({
				operationId: operation.id,
				initiatedBy: operation.initiatedBy,
				bytes: boundedBytes(bytes),
			});
		};
		await upload('canonical-concurrency-foundation', transparentPixelPng);
		const before = await context.catalogue.getCapacity();
		const firstCandidate = pngWithTextChunks(1);
		const secondCandidate = pngWithTextChunks(2);
		const hardLimit = before.canonical.usedBytes
			+ Math.max(firstCandidate.byteLength, secondCandidate.byteLength);
		await setCapacityLimits(context, {
			canonicalLimitBytes: hardLimit,
			stagingLimitBytes: before.staging.limitBytes,
		});

		const outcomes = await Promise.all([
			upload('canonical-concurrency-first', firstCandidate),
			upload('canonical-concurrency-second', secondCandidate),
		]);

		expect(outcomes.filter(outcome => outcome.stage === 'completed')).toHaveLength(1);
		expect(outcomes.filter(
			outcome => outcome.failure?.code === 'canonical-capacity-exhausted',
		)).toHaveLength(1);
		const after = await context.catalogue.getCapacity();
		expect(after.canonical.usedBytes).toBeLessThanOrEqual(hardLimit);
		expect(after.canonical.reservedBytes).toBe(0);
	});
});
