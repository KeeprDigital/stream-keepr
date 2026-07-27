import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
	createGraphicsAssetLibrary,
	createInMemoryGraphicsAssetCatalogue,
} from '~~/server/modules/graphics-asset-library';
import {
	createInMemoryCanonicalGraphicsObjectStore,
	createInMemoryStagingGraphicsObjectStore,
} from '~~/server/modules/graphics-asset-library/in-memory-object-store';
import {
	consumeBoundedByteStream,
	createBoundedByteStream,
} from '~~/server/modules/graphics-asset-library/object-store';

const transparentPixelPng = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
));

function createLibrary(
	staging = createInMemoryStagingGraphicsObjectStore(),
	canonical = createInMemoryCanonicalGraphicsObjectStore(),
	catalogue = createInMemoryGraphicsAssetCatalogue(),
) {
	let nextIdentity = 0;
	const library = createGraphicsAssetLibrary({
		catalogue,
		staging,
		canonical,
		generateIdentity: () => `identity-${++nextIdentity}`,
		now: () => new Date('2026-07-27T04:00:00.000Z'),
	});
	return { library, staging, canonical, catalogue };
}

describe('pNG ingestion through the Graphics Asset Library public module', () => {
	it('durably publishes one validated PNG and discovers it with its exact operation result', async () => {
		const { library } = createLibrary();
		const initiation = {
			idempotencyKey: 'upload-scoreboard-logo',
			initiatedBy: 'graphics-author-1',
			name: 'Scoreboard logo',
			defaultEventId: 7,
			declaredByteLength: transparentPixelPng.byteLength,
		};

		const operation = await library.initiatePngIngestion(initiation);
		const reconnected = await library.initiatePngIngestion(initiation);

		expect(operation).toMatchObject({
			stage: 'created',
			duplicateContentPolicy: 'reuse',
			transferredByteLength: 0,
			declaredByteLength: transparentPixelPng.byteLength,
		});
		expect(reconnected).toEqual(operation);
		await expect(library.listGraphicAssets({ search: '' })).resolves.toEqual([]);

		const completed = await library.uploadPng({
			operationId: operation.id,
			initiatedBy: 'graphics-author-1',
			bytes: createBoundedByteStream(transparentPixelPng, {
				byteLength: transparentPixelPng.byteLength,
				maximumByteLength: 16 * 1024 * 1024,
			}),
		});

		expect(completed).toMatchObject({
			stage: 'completed',
			transferredByteLength: transparentPixelPng.byteLength,
			report: {
				outcome: 'accepted',
				compatibilityProfile: 'png-v1',
				issues: [],
				facts: {
					kind: 'image',
					canonicalMime: 'image/png',
					byteLength: transparentPixelPng.byteLength,
					sha256: '431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460',
					width: 1,
					height: 1,
					pixelCount: 1,
					bitDepth: 8,
					colorModel: 'grayscale-alpha',
					hasAlpha: true,
				},
			},
			result: {
				outcome: 'published',
				assetId: expect.any(String),
				revisionId: expect.any(String),
			},
		});

		await expect(library.getIngestionOperation({
			operationId: operation.id,
			initiatedBy: 'graphics-author-1',
		})).resolves.toEqual(completed);

		await expect(library.listGraphicAssets({ search: 'scoreboard' })).resolves.toEqual([
			expect.objectContaining({
				id: completed.result?.assetId,
				name: 'Scoreboard logo',
				kind: 'image',
				revisionId: completed.result?.revisionId,
				revisionNumber: 1,
				eventIds: [7],
				facts: completed.report?.facts,
				operation: completed,
			}),
		]);

		const preview = await library.resolveGraphicAssetThumbnail({
			assetId: completed.result!.assetId,
		});
		expect(preview.outcome).toBe('available');
		if (preview.outcome !== 'available')
			throw new Error('Expected the published thumbnail to be available');
		const previewBytes = await consumeBoundedByteStream({
			body: preview.body,
			byteLength: preview.byteLength,
			maximumByteLength: preview.byteLength,
		});
		expect(preview.contentType).toBe('image/png');
		expect(Array.from(previewBytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
	});

	it('records permanent validation failure without publishing catalogue state', async () => {
		const { library } = createLibrary();
		const invalidPng = new TextEncoder().encode('not a PNG');
		const operation = await library.initiatePngIngestion({
			idempotencyKey: 'invalid-logo',
			initiatedBy: 'graphics-author-1',
			name: 'Invalid logo',
			declaredByteLength: invalidPng.byteLength,
		});

		const failed = await library.uploadPng({
			operationId: operation.id,
			initiatedBy: 'graphics-author-1',
			bytes: createBoundedByteStream(invalidPng, {
				byteLength: invalidPng.byteLength,
				maximumByteLength: 16 * 1024 * 1024,
			}),
		});

		expect(failed).toMatchObject({
			stage: 'failed',
			report: {
				outcome: 'rejected',
				compatibilityProfile: 'png-v1',
				issues: [{
					severity: 'error',
					code: 'invalid-png-signature',
				}],
			},
			failure: {
				code: 'validation-failed',
				retryable: false,
			},
		});
		await expect(library.listGraphicAssets({})).resolves.toEqual([]);
	});

	it('cancels idempotently before publication and never accepts later transfer bytes', async () => {
		const { library } = createLibrary();
		const operation = await library.initiatePngIngestion({
			idempotencyKey: 'cancelled-logo',
			initiatedBy: 'graphics-author-1',
			name: 'Cancelled logo',
			declaredByteLength: transparentPixelPng.byteLength,
		});

		const cancelled = await library.cancelPngIngestion({
			operationId: operation.id,
			initiatedBy: 'graphics-author-1',
		});
		const cancelledAgain = await library.cancelPngIngestion({
			operationId: operation.id,
			initiatedBy: 'graphics-author-1',
		});
		const uploadAfterCancellation = await library.uploadPng({
			operationId: operation.id,
			initiatedBy: 'graphics-author-1',
			bytes: createBoundedByteStream(transparentPixelPng, {
				byteLength: transparentPixelPng.byteLength,
				maximumByteLength: 16 * 1024 * 1024,
			}),
		});

		expect(cancelled).toMatchObject({
			stage: 'cancelled',
			failure: {
				code: 'ingestion-cancelled',
				retryable: false,
			},
		});
		expect(cancelledAgain).toEqual(cancelled);
		expect(uploadAfterCancellation).toEqual(cancelled);
		await expect(library.listGraphicAssets({})).resolves.toEqual([]);
	});

	it('honours cancellation at the transfer checkpoint without publishing', async () => {
		const delegate = createInMemoryStagingGraphicsObjectStore();
		let releaseTransfer!: () => void;
		let markTransferStarted!: () => void;
		const transferStarted = new Promise<void>((resolve) => {
			markTransferStarted = resolve;
		});
		const transferReleased = new Promise<void>((resolve) => {
			releaseTransfer = resolve;
		});
		const staging = {
			...delegate,
			async createImmutable(input: Parameters<typeof delegate.createImmutable>[0]) {
				markTransferStarted();
				await transferReleased;
				return await delegate.createImmutable(input);
			},
		};
		const { library } = createLibrary(staging);
		const operation = await library.initiatePngIngestion({
			idempotencyKey: 'cancel-during-transfer',
			initiatedBy: 'graphics-author-1',
			name: 'Cancelled during transfer',
			declaredByteLength: transparentPixelPng.byteLength,
		});

		const upload = library.uploadPng({
			operationId: operation.id,
			initiatedBy: 'graphics-author-1',
			bytes: createBoundedByteStream(transparentPixelPng, {
				byteLength: transparentPixelPng.byteLength,
				maximumByteLength: 16 * 1024 * 1024,
			}),
		});
		await transferStarted;
		const cancelled = await library.cancelPngIngestion({
			operationId: operation.id,
			initiatedBy: 'graphics-author-1',
		});
		releaseTransfer();

		expect(cancelled.stage).toBe('cancelled');
		await expect(upload).resolves.toEqual(cancelled);
		await expect(library.listGraphicAssets({})).resolves.toEqual([]);
	});

	it('resumes from staged bytes after a retryable canonical-store failure', async () => {
		const { library, canonical } = createLibrary();
		const operation = await library.initiatePngIngestion({
			idempotencyKey: 'retry-logo',
			initiatedBy: 'graphics-author-1',
			name: 'Retry logo',
			declaredByteLength: transparentPixelPng.byteLength,
		});
		canonical.injectTransientFailure('create');

		const failed = await library.uploadPng({
			operationId: operation.id,
			initiatedBy: 'graphics-author-1',
			bytes: createBoundedByteStream(transparentPixelPng, {
				byteLength: transparentPixelPng.byteLength,
				maximumByteLength: 16 * 1024 * 1024,
			}),
		});
		expect(failed).toMatchObject({
			stage: 'failed',
			transferredByteLength: transparentPixelPng.byteLength,
			failure: {
				code: 'canonical-store-unavailable',
				retryable: true,
			},
		});

		const completed = await library.retryPngIngestion({
			operationId: operation.id,
			initiatedBy: 'graphics-author-1',
		});
		expect(completed).toMatchObject({
			stage: 'completed',
			result: { outcome: 'published' },
		});
		await expect(library.listGraphicAssets({ search: 'retry' })).resolves.toHaveLength(1);
	});

	it('reuses an existing Graphic Asset for ordinary duplicate content', async () => {
		const { library } = createLibrary();

		async function ingest(idempotencyKey: string, name: string, defaultEventId: number) {
			const operation = await library.initiatePngIngestion({
				idempotencyKey,
				initiatedBy: 'graphics-author-1',
				name,
				defaultEventId,
				declaredByteLength: transparentPixelPng.byteLength,
			});
			return await library.uploadPng({
				operationId: operation.id,
				initiatedBy: 'graphics-author-1',
				bytes: createBoundedByteStream(transparentPixelPng, {
					byteLength: transparentPixelPng.byteLength,
					maximumByteLength: 16 * 1024 * 1024,
				}),
			});
		}

		const published = await ingest('original-logo', 'Original logo', 7);
		const reused = await ingest('duplicate-logo', 'Duplicate upload name', 9);

		expect(published.result).toMatchObject({ outcome: 'published' });
		expect(reused.result).toEqual({
			outcome: 'reused',
			assetId: published.result?.assetId,
			revisionId: published.result?.revisionId,
		});
		await expect(library.listGraphicAssets({ search: '' })).resolves.toEqual([
			expect.objectContaining({
				id: published.result?.assetId,
				name: 'Original logo',
				eventIds: [7, 9],
				operation: reused,
			}),
		]);
	});

	it('publishes a separate Graphic Asset when duplicate content reuse is explicitly disabled', async () => {
		const { library } = createLibrary();

		async function ingest(idempotencyKey: string, duplicateContentPolicy: 'reuse' | 'create-separate') {
			const operation = await library.initiatePngIngestion({
				idempotencyKey,
				initiatedBy: 'graphics-author-1',
				name: idempotencyKey,
				duplicateContentPolicy,
				declaredByteLength: transparentPixelPng.byteLength,
			});
			return await library.uploadPng({
				operationId: operation.id,
				initiatedBy: operation.initiatedBy,
				bytes: createBoundedByteStream(transparentPixelPng, {
					byteLength: transparentPixelPng.byteLength,
					maximumByteLength: 16 * 1024 * 1024,
				}),
			});
		}

		const original = await ingest('original-identity', 'reuse');
		const separate = await ingest('separate-identity', 'create-separate');

		expect(original.result?.outcome).toBe('published');
		expect(separate.result?.outcome).toBe('published');
		expect(separate.result?.assetId).not.toBe(original.result?.assetId);
		await expect(library.listGraphicAssets({})).resolves.toHaveLength(2);
	});

	it('does not publish when canonical bytes do not hash to their digest identity', async () => {
		const delegate = createInMemoryCanonicalGraphicsObjectStore();
		const canonical = {
			...delegate,
			async read(...input: Parameters<typeof delegate.read>) {
				const stored = await delegate.read(...input);
				if (stored.outcome !== 'available')
					return stored;
				return {
					...stored,
					body: new ReadableStream<Uint8Array>({
						start(controller) {
							controller.enqueue(new Uint8Array(stored.object.byteLength));
							controller.close();
						},
					}),
				};
			},
		};
		const { library } = createLibrary(createInMemoryStagingGraphicsObjectStore(), canonical);
		const operation = await library.initiatePngIngestion({
			idempotencyKey: 'corrupt-canonical-logo',
			initiatedBy: 'graphics-author-1',
			name: 'Corrupt canonical logo',
			declaredByteLength: transparentPixelPng.byteLength,
		});

		const failed = await library.uploadPng({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			bytes: createBoundedByteStream(transparentPixelPng, {
				byteLength: transparentPixelPng.byteLength,
				maximumByteLength: 16 * 1024 * 1024,
			}),
		});

		expect(failed).toMatchObject({
			stage: 'failed',
			failure: {
				code: 'canonical-store-unavailable',
				retryable: true,
			},
		});
		await expect(library.listGraphicAssets({})).resolves.toEqual([]);
	});

	it('atomically reuses content when two ordinary ingestions publish concurrently', async () => {
		const delegate = createInMemoryGraphicsAssetCatalogue();
		let reusableLookups = 0;
		let releaseLookups!: () => void;
		const bothLooking = new Promise<void>((resolve) => {
			releaseLookups = resolve;
		});
		const catalogue = {
			...delegate,
			async findReusablePng(sourceDigest: string) {
				reusableLookups++;
				if (reusableLookups === 2)
					releaseLookups();
				await bothLooking;
				return await delegate.findReusablePng(sourceDigest);
			},
		};
		const { library } = createLibrary(
			createInMemoryStagingGraphicsObjectStore(),
			createInMemoryCanonicalGraphicsObjectStore(),
			catalogue,
		);
		const operations = await Promise.all([
			library.initiatePngIngestion({
				idempotencyKey: 'concurrent-a',
				initiatedBy: 'graphics-author-1',
				name: 'Concurrent A',
				declaredByteLength: transparentPixelPng.byteLength,
			}),
			library.initiatePngIngestion({
				idempotencyKey: 'concurrent-b',
				initiatedBy: 'graphics-author-1',
				name: 'Concurrent B',
				declaredByteLength: transparentPixelPng.byteLength,
			}),
		]);
		const completed = await Promise.all(operations.map(operation => library.uploadPng({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			bytes: createBoundedByteStream(transparentPixelPng, {
				byteLength: transparentPixelPng.byteLength,
				maximumByteLength: 16 * 1024 * 1024,
			}),
		})));

		expect(completed.map(operation => operation.result?.outcome).sort())
			.toEqual(['published', 'reused']);
		expect(completed[0]!.result?.assetId).toBe(completed[1]!.result?.assetId);
		await expect(library.listGraphicAssets({})).resolves.toHaveLength(1);
	});

	it('honours cancellation after entering publishing but before catalogue publication', async () => {
		const delegate = createInMemoryGraphicsAssetCatalogue();
		let publicationStarted!: () => void;
		let releasePublication!: () => void;
		const started = new Promise<void>((resolve) => {
			publicationStarted = resolve;
		});
		const released = new Promise<void>((resolve) => {
			releasePublication = resolve;
		});
		const catalogue = {
			...delegate,
			async publishPng(input: Parameters<typeof delegate.publishPng>[0]) {
				publicationStarted();
				await released;
				return await delegate.publishPng(input);
			},
		};
		const { library } = createLibrary(
			createInMemoryStagingGraphicsObjectStore(),
			createInMemoryCanonicalGraphicsObjectStore(),
			catalogue,
		);
		const operation = await library.initiatePngIngestion({
			idempotencyKey: 'cancel-before-publication',
			initiatedBy: 'graphics-author-1',
			name: 'Cancelled before publication',
			declaredByteLength: transparentPixelPng.byteLength,
		});
		const upload = library.uploadPng({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			bytes: createBoundedByteStream(transparentPixelPng, {
				byteLength: transparentPixelPng.byteLength,
				maximumByteLength: 16 * 1024 * 1024,
			}),
		});
		await started;
		const cancelled = await library.cancelPngIngestion({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
		});
		releasePublication();

		expect(cancelled.stage).toBe('cancelled');
		await expect(upload).resolves.toEqual(cancelled);
		await expect(library.listGraphicAssets({})).resolves.toEqual([]);
	});

	it('fences a displaced processor after a stale operation is claimed', async () => {
		const { library, catalogue } = createLibrary();
		const created = await library.initiatePngIngestion({
			idempotencyKey: 'fenced-retry',
			initiatedBy: 'graphics-author-1',
			name: 'Fenced retry',
			declaredByteLength: transparentPixelPng.byteLength,
		});
		const transferring = {
			...created,
			stage: 'transferring' as const,
			updatedAt: '2026-07-27T04:00:01.000Z',
		};
		await catalogue.updateIngestionOperation(transferring, created.updatedAt);
		const claimed = await catalogue.claimPngIngestion({
			operation: transferring,
			claimedAt: '2026-07-27T04:01:00.000Z',
			staleBefore: '2026-07-27T04:00:30.000Z',
		});

		expect(claimed?.stage).toBe('hashing');
		await expect(catalogue.updateIngestionOperation({
			...transferring,
			stage: 'validating',
			updatedAt: '2026-07-27T04:01:01.000Z',
		}, transferring.updatedAt)).rejects.toThrow('lost its claim');
	});
});
