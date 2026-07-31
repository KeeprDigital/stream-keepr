import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	createGraphicsAssetLibrary,
	createInMemoryGraphicsAssetCatalogue,
	GraphicsAssetLibraryError,
} from '~~/server/modules/graphics-asset-library';
import {
	createInMemoryCanonicalGraphicsObjectStore,
	createInMemoryStagingGraphicsObjectStore,
} from '~~/server/modules/graphics-asset-library/in-memory-object-store';
import {
	createBoundedByteStream,
	graphicsObjectIdentity,
} from '~~/server/modules/graphics-asset-library/object-store';
import {
	DEFAULT_GRAPHICS_CANONICAL_QUOTA_BYTES,
	DEFAULT_GRAPHICS_STAGING_ALLOWANCE_BYTES,
} from '~~/shared/types/graphicsAsset';

describe('the Graphics Asset Library Capacity', () => {
	const transparentPixelPng = Uint8Array.from(Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
		'base64',
	));
	const textChunk = Uint8Array.of(0, 0, 0, 0, 0x74, 0x45, 0x58, 0x74, 0x96, 0x42, 0xC5, 0x85);
	const pngWithTextChunks = (count: number) => Uint8Array.from(Buffer.concat([
		transparentPixelPng.slice(0, -12),
		...Array.from({ length: count }).fill(textChunk),
		transparentPixelPng.slice(-12),
	]));
	const browserDecodeEvidence = (bytes: Uint8Array) => ({
		outcome: 'decoded' as const,
		sourceDigest: createHash('sha256').update(bytes).digest('hex'),
		width: 1,
		height: 1,
	});

	it('reports the installation defaults and separate canonical usage categories', async () => {
		const library = createGraphicsAssetLibrary({
			catalogue: createInMemoryGraphicsAssetCatalogue(),
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

	it('admits concurrent staging work only while worst-case reservations fit', async () => {
		const library = createGraphicsAssetLibrary({
			catalogue: createInMemoryGraphicsAssetCatalogue({ stagingLimitBytes: 68 }),
			staging: createInMemoryStagingGraphicsObjectStore(),
			canonical: createInMemoryCanonicalGraphicsObjectStore(),
		});
		const admission = (idempotencyKey: string) => library.initiateGraphicsIngestion({
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
		await expect(library.getCapacity()).resolves.toMatchObject({
			staging: {
				usedBytes: 0,
				reservedBytes: 68,
				availableBytes: 0,
			},
		});

		await library.cancelGraphicsIngestion({
			operationId: accepted!.value.id,
			initiatedBy: accepted!.value.initiatedBy,
		});
		await expect(library.getCapacity()).resolves.toMatchObject({
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
		const library = createGraphicsAssetLibrary({
			catalogue: createInMemoryGraphicsAssetCatalogue({
				stagingLimitBytes: transparentPixelPng.byteLength,
			}),
			staging: createInMemoryStagingGraphicsObjectStore(),
			canonical,
		});
		const operation = await library.initiateGraphicsIngestion({
			idempotencyKey: 'verified-staging-progress',
			initiatedBy: 'graphics-author-1',
			name: 'Verified staging progress',
			browserDecodeEvidence: browserDecodeEvidence(transparentPixelPng),
			declaredByteLength: transparentPixelPng.byteLength,
		});
		const upload = library.uploadGraphicAsset({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			bytes: createBoundedByteStream(transparentPixelPng, {
				byteLength: transparentPixelPng.byteLength,
				maximumByteLength: transparentPixelPng.byteLength,
			}),
		});

		await canonicalStarted;
		await expect(library.getCapacity()).resolves.toMatchObject({
			staging: {
				usedBytes: transparentPixelPng.byteLength,
				reservedBytes: 0,
				availableBytes: 0,
			},
		});

		releaseCanonical();
		await expect(upload).resolves.toMatchObject({ stage: 'completed' });
		await expect(library.getCapacity()).resolves.toMatchObject({
			staging: {
				usedBytes: 0,
				reservedBytes: 0,
				availableBytes: transparentPixelPng.byteLength,
			},
		});
	});

	it('accounts for catalogue metadata and unreachable canonical writes separately', async () => {
		const catalogue = createInMemoryGraphicsAssetCatalogue();
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
			contents: [{ digest: 'unreachable-digest', byteLength: 123 }],
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

	it('blocks canonical growth before writing bytes when the hard limit is exhausted', async () => {
		const canonical = createInMemoryCanonicalGraphicsObjectStore();
		const library = createGraphicsAssetLibrary({
			catalogue: createInMemoryGraphicsAssetCatalogue({ canonicalLimitBytes: 1 }),
			staging: createInMemoryStagingGraphicsObjectStore(),
			canonical,
		});
		const operation = await library.initiateGraphicsIngestion({
			idempotencyKey: 'blocked-canonical-growth',
			initiatedBy: 'graphics-author-1',
			name: 'Blocked canonical growth',
			browserDecodeEvidence: browserDecodeEvidence(transparentPixelPng),
			declaredByteLength: transparentPixelPng.byteLength,
		});

		const blocked = await library.uploadGraphicAsset({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			bytes: createBoundedByteStream(transparentPixelPng, {
				byteLength: transparentPixelPng.byteLength,
				maximumByteLength: transparentPixelPng.byteLength,
			}),
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
		await expect(library.listGraphicAssets({})).resolves.toEqual([]);
		await expect(library.getCapacity()).resolves.toMatchObject({
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
		const catalogue = createInMemoryGraphicsAssetCatalogue();
		let claimLost = false;
		const library = createGraphicsAssetLibrary({
			// A lost claim is a race between two attempts at one operation, so it
			// cannot be staged from outside. The reservation is where the catalogue
			// detects it, which is where it is handed to the library here.
			catalogue: new Proxy(catalogue, {
				get(target, property, receiver) {
					if (property === 'reserveGraphicAssetPublication' && claimLost)
						return async () => ({ outcome: 'lost-claim' as const });
					return Reflect.get(target, property, receiver);
				},
			}),
			staging: createInMemoryStagingGraphicsObjectStore(),
			canonical: createInMemoryCanonicalGraphicsObjectStore(),
		});
		const operation = await library.initiateGraphicsIngestion({
			idempotencyKey: 'lost-publication-claim',
			initiatedBy: 'graphics-author-1',
			name: 'Lost publication claim',
			browserDecodeEvidence: browserDecodeEvidence(transparentPixelPng),
			declaredByteLength: transparentPixelPng.byteLength,
		});
		claimLost = true;

		const answered = await library.uploadGraphicAsset({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			bytes: createBoundedByteStream(transparentPixelPng, {
				byteLength: transparentPixelPng.byteLength,
				maximumByteLength: transparentPixelPng.byteLength,
			}),
		});

		// The library holds nothing and its quota is untouched, so capacity was
		// never the condition: an author sent to free space would find nothing to
		// free. What comes back is the operation as it actually stands.
		expect(answered.failure).toBeUndefined();
		expect(answered.canonicalCapacityOutcome).toBeUndefined();
		expect(answered.stage).toBe('generating-derivatives');
		await expect(library.getCapacity()).resolves.toMatchObject({
			canonical: { usedBytes: 0, reservedBytes: 0 },
		});
	});

	it('publishes proven no-growth content at the full Canonical Graphics Quota', async () => {
		const library = createGraphicsAssetLibrary({
			catalogue: createInMemoryGraphicsAssetCatalogue(),
			staging: createInMemoryStagingGraphicsObjectStore(),
			canonical: createInMemoryCanonicalGraphicsObjectStore(),
		});
		const upload = async (idempotencyKey: string) => {
			const operation = await library.initiateGraphicsIngestion({
				idempotencyKey,
				initiatedBy: 'graphics-author-1',
				name: idempotencyKey,
				duplicateContentPolicy: 'create-separate',
				browserDecodeEvidence: browserDecodeEvidence(transparentPixelPng),
				declaredByteLength: transparentPixelPng.byteLength,
			});
			return await library.uploadGraphicAsset({
				operationId: operation.id,
				initiatedBy: operation.initiatedBy,
				bytes: createBoundedByteStream(transparentPixelPng, {
					byteLength: transparentPixelPng.byteLength,
					maximumByteLength: transparentPixelPng.byteLength,
				}),
			});
		};

		const first = await upload('first-canonical-copy');
		expect(first.canonicalCapacityOutcome).toMatchObject({
			outcome: 'canonical-growth-reserved',
			growthBytes: expect.any(Number),
		});
		const initialCapacity = await library.getCapacity();
		expect(initialCapacity.canonical.breakdown.retainedSourceBytes)
			.toBe(transparentPixelPng.byteLength);
		expect(initialCapacity.canonical.breakdown.retainedDerivativeBytes)
			.toBeGreaterThan(0);
		expect(initialCapacity.canonical.usedBytes).toBe(
			initialCapacity.canonical.breakdown.retainedSourceBytes
			+ initialCapacity.canonical.breakdown.retainedDerivativeBytes,
		);

		await library.updateCapacityLimits({
			canonicalLimitBytes: initialCapacity.canonical.usedBytes,
			stagingLimitBytes: initialCapacity.staging.limitBytes,
		});
		await expect(library.getCapacity()).resolves.toMatchObject({
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
		await expect(library.getCapacity()).resolves.toMatchObject({
			canonical: {
				usedBytes: initialCapacity.canonical.usedBytes,
				reservedBytes: 0,
				availableBytes: 0,
			},
		});
	});

	it('reports warning pressure at 80% and critical pressure at 95%', async () => {
		const library = createGraphicsAssetLibrary({
			catalogue: createInMemoryGraphicsAssetCatalogue(),
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
			bytes: createBoundedByteStream(transparentPixelPng, {
				byteLength: transparentPixelPng.byteLength,
				maximumByteLength: transparentPixelPng.byteLength,
			}),
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

	it('keeps concurrent canonical publication reservations within the hard limit', async () => {
		const library = createGraphicsAssetLibrary({
			catalogue: createInMemoryGraphicsAssetCatalogue(),
			staging: createInMemoryStagingGraphicsObjectStore(),
			canonical: createInMemoryCanonicalGraphicsObjectStore(),
		});
		const upload = async (idempotencyKey: string, bytes: Uint8Array) => {
			const operation = await library.initiateGraphicsIngestion({
				idempotencyKey,
				initiatedBy: 'graphics-author-1',
				name: idempotencyKey,
				duplicateContentPolicy: 'create-separate',
				browserDecodeEvidence: browserDecodeEvidence(bytes),
				declaredByteLength: bytes.byteLength,
			});
			return await library.uploadGraphicAsset({
				operationId: operation.id,
				initiatedBy: operation.initiatedBy,
				bytes: createBoundedByteStream(bytes, {
					byteLength: bytes.byteLength,
					maximumByteLength: bytes.byteLength,
				}),
			});
		};
		await upload('canonical-concurrency-foundation', transparentPixelPng);
		const before = await library.getCapacity();
		const firstCandidate = pngWithTextChunks(1);
		const secondCandidate = pngWithTextChunks(2);
		const hardLimit = before.canonical.usedBytes
			+ Math.max(firstCandidate.byteLength, secondCandidate.byteLength);
		await library.updateCapacityLimits({
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
		const after = await library.getCapacity();
		expect(after.canonical.usedBytes).toBeLessThanOrEqual(hardLimit);
		expect(after.canonical.reservedBytes).toBe(0);
	});
});
