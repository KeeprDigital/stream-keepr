import type { GraphicAssetValidationReport } from '~~/shared/types/graphicsAsset';
import type { SqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createGraphicsAssetLibrary,
	graphicAssetRevisionId,
} from '~~/server/modules/graphics-asset-library';
import { createD1GraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library/catalogue';
import {
	createInMemoryCanonicalGraphicsObjectStore,
	createInMemoryStagingGraphicsObjectStore,
} from '~~/server/modules/graphics-asset-library/in-memory-object-store';
import {
	consumeBoundedByteStream,
	createBoundedByteStream,
	graphicsObjectIdentity,
} from '~~/server/modules/graphics-asset-library/object-store';
import { digestOf, pixelPng as transparentPixelPng } from '~~/test/helpers/graphicsFixtures';
import { jpegPixel, webpPixel } from '~~/test/helpers/graphicsImageFixtures';
import { addEvent, boundedBytes } from '~~/test/helpers/graphicsLibrary';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

let harness: SqliteD1Harness;

beforeEach(async () => {
	harness = await createSqliteD1Harness();
});

afterEach(async () => {
	await harness.close();
});

// Only an accepted validation report carries facts, so a reading of them has
// to say which outcome it expected rather than assume one.
function acceptedReport(report: GraphicAssetValidationReport | undefined) {
	if (report?.outcome !== 'accepted')
		throw new Error(`expected an accepted validation report, got ${report?.outcome ?? 'none'}`);
	return report;
}

function createLibrary(
	staging = createInMemoryStagingGraphicsObjectStore(),
	canonical = createInMemoryCanonicalGraphicsObjectStore(),
	catalogue = createD1GraphicsAssetCatalogue(harness.database),
	now = () => new Date('2026-07-27T04:00:00.000Z'),
	silentVideoPlaybackValidator?: {
		validate: (input: any) => Promise<any>;
	},
) {
	let nextIdentity = 0;
	const libraryDelegate = createGraphicsAssetLibrary({
		catalogue,
		staging,
		canonical,
		generateIdentity: () => `identity-${++nextIdentity}`,
		now,
		silentVideoPlaybackValidator,
	});
	const library: typeof libraryDelegate = {
		...libraryDelegate,
		async initiateGraphicsIngestion(input) {
			const fixture = input.declaredMime === 'image/jpeg'
				? jpegPixel
				: input.declaredMime === 'image/webp'
					? webpPixel
					: transparentPixelPng;
			return await libraryDelegate.initiateGraphicsIngestion({
				...input,
				browserDecodeEvidence: input.declaredMime?.startsWith('video/')
					? input.browserDecodeEvidence
					: Object.hasOwn(input, 'browserDecodeEvidence')
						? input.browserDecodeEvidence
						: {
								outcome: 'decoded',
								sourceDigest: digestOf(fixture),
								width: 1,
								height: 1,
							},
			});
		},
	};
	return {
		library,
		staging,
		canonical,
		catalogue,
	};
}

describe('still-image ingestion through the Graphics Asset Library public module', () => {
	it('resolves only the pinned revision and distinguishes missing from unavailable content', async () => {
		const { library, canonical } = createLibrary();
		const operation = await library.initiateGraphicsIngestion({
			idempotencyKey: 'pinned-scoreboard-logo',
			initiatedBy: 'graphics-author-1',
			name: 'Pinned scoreboard logo',
			declaredByteLength: transparentPixelPng.byteLength,
		});
		const completed = await library.uploadGraphicAsset({
			operationId: operation.id,
			initiatedBy: 'graphics-author-1',
			bytes: createBoundedByteStream(transparentPixelPng, {
				byteLength: transparentPixelPng.byteLength,
				maximumByteLength: 16 * 1024 * 1024,
			}),
		});
		const reference = {
			assetId: completed.result!.assetId,
			revisionId: completed.result!.revisionId,
		};

		const available = await library.resolveGraphicAssetRevision(reference);
		expect(available).toMatchObject({
			outcome: 'available',
			byteLength: transparentPixelPng.byteLength,
			contentType: 'image/png',
		});
		if (available.outcome !== 'available')
			throw new Error('Expected the pinned revision to resolve');
		await expect(consumeBoundedByteStream({
			body: available.body,
			byteLength: available.byteLength,
			maximumByteLength: available.byteLength,
		})).resolves.toEqual(transparentPixelPng);

		await expect(library.resolveGraphicAssetRevision({
			assetId: reference.assetId,
			revisionId: graphicAssetRevisionId('missing-revision'),
		})).resolves.toEqual({ outcome: 'missing' });
		await expect(library.inspectGraphicAssetRevision(reference)).resolves.toEqual({
			outcome: 'available',
			lifecycleState: 'active',
			kind: 'image',
		});
		await expect(library.inspectGraphicAssetRevision({
			assetId: reference.assetId,
			revisionId: graphicAssetRevisionId('missing-revision'),
		})).resolves.toEqual({ outcome: 'missing' });

		canonical.markUnavailable(
			graphicsObjectIdentity(`sha256/${acceptedReport(completed.report).facts.sha256}`),
		);
		await expect(library.resolveGraphicAssetRevision(reference)).resolves.toEqual({
			outcome: 'unavailable',
			retryable: true,
		});
		await expect(library.inspectGraphicAssetRevision(reference)).resolves.toEqual({
			outcome: 'unavailable',
			retryable: true,
		});
	});

	// The #374 pin: a batched inspection answers by input position from one
	// catalogue lookup and one canonical observation per distinct content digest,
	// never one round-trip per reference.
	it('inspects a batch of revisions with one observation per distinct content', async () => {
		const canonicalDelegate = createInMemoryCanonicalGraphicsObjectStore();
		const readMetadata = vi.fn(canonicalDelegate.readMetadata);
		const { library } = createLibrary(
			createInMemoryStagingGraphicsObjectStore(),
			{ ...canonicalDelegate, readMetadata },
		);

		async function ingested(key: string, bytes: Uint8Array, declaredMime?: string) {
			const operation = await library.initiateGraphicsIngestion({
				idempotencyKey: key,
				initiatedBy: 'graphics-author-1',
				name: key,
				declaredMime,
				duplicateContentPolicy: 'create-separate',
				declaredByteLength: bytes.byteLength,
			});
			const completed = await library.uploadGraphicAsset({
				operationId: operation.id,
				initiatedBy: 'graphics-author-1',
				declaredMime,
				bytes: createBoundedByteStream(bytes, {
					byteLength: bytes.byteLength,
					maximumByteLength: 16 * 1024 * 1024,
				}),
			});
			return {
				assetId: completed.result!.assetId,
				revisionId: completed.result!.revisionId,
				report: completed.report,
			};
		}

		const png = await ingested('batch-logo-png', transparentPixelPng);
		const jpeg = await ingested('batch-logo-jpeg', jpegPixel, 'image/jpeg');
		// Same bytes as `png` under create-separate: a second revision pinning the
		// same content digest, which the observation dedupe must fold into one.
		const pngTwin = await ingested('batch-logo-png-twin', transparentPixelPng);
		const missing = {
			assetId: png.assetId,
			revisionId: graphicAssetRevisionId('missing-revision'),
		};

		readMetadata.mockClear();
		const statuses = await library.inspectGraphicAssetRevisions({
			references: [png, jpeg, pngTwin, png, missing],
		});

		expect(statuses).toEqual([
			{ outcome: 'available', lifecycleState: 'active', kind: 'image' },
			{ outcome: 'available', lifecycleState: 'active', kind: 'image' },
			{ outcome: 'available', lifecycleState: 'active', kind: 'image' },
			{ outcome: 'available', lifecycleState: 'active', kind: 'image' },
			{ outcome: 'missing' },
		]);
		// Five references, three revisions, two distinct contents: two observations.
		expect(readMetadata).toHaveBeenCalledTimes(2);

		canonicalDelegate.markUnavailable(
			graphicsObjectIdentity(`sha256/${acceptedReport(png.report).facts.sha256}`),
		);
		await expect(library.inspectGraphicAssetRevisions({
			references: [png, jpeg, pngTwin],
		})).resolves.toEqual([
			{ outcome: 'unavailable', retryable: true },
			{ outcome: 'available', lifecycleState: 'active', kind: 'image' },
			{ outcome: 'unavailable', retryable: true },
		]);
	});

	it('threads an exact requested byte range to canonical storage', async () => {
		const canonicalDelegate = createInMemoryCanonicalGraphicsObjectStore();
		const read = vi.fn(canonicalDelegate.read);
		const { library } = createLibrary(
			createInMemoryStagingGraphicsObjectStore(),
			{ ...canonicalDelegate, read },
		);
		const operation = await library.initiateGraphicsIngestion({
			idempotencyKey: 'range-scoreboard-logo',
			initiatedBy: 'graphics-author-1',
			name: 'Range scoreboard logo',
			declaredByteLength: transparentPixelPng.byteLength,
		});
		const completed = await library.uploadGraphicAsset({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			bytes: createBoundedByteStream(transparentPixelPng, {
				byteLength: transparentPixelPng.byteLength,
				maximumByteLength: 16 * 1024 * 1024,
			}),
		});
		read.mockClear();

		const resolved = await library.resolveGraphicAssetRevision({
			assetId: completed.result!.assetId,
			revisionId: completed.result!.revisionId,
			range: { offset: 24, length: 8 },
		});

		expect(read).toHaveBeenCalledWith(
			graphicsObjectIdentity(`sha256/${acceptedReport(completed.report).facts.sha256}`),
			{ offset: 24, length: 8 },
		);
		expect(resolved).toMatchObject({
			outcome: 'available',
			byteLength: transparentPixelPng.byteLength,
		});
		if (resolved.outcome !== 'available')
			throw new Error('Expected ranged content to resolve');
		await expect(
			new Response(resolved.body).arrayBuffer(),
		).resolves.toEqual(transparentPixelPng.slice(24, 32).buffer);
	});

	it('updates Graphic Asset metadata and Event associations without creating a Graphic Asset Revision', async () => {
		const { library } = createLibrary();
		await Promise.all([7, 9, 11].map(eventId => addEvent(harness, eventId)));
		const operation = await library.initiateGraphicsIngestion({
			idempotencyKey: 'metadata-original',
			initiatedBy: 'graphics-author-1',
			name: 'Original name',
			defaultEventId: 7,
			declaredByteLength: transparentPixelPng.byteLength,
		});
		const completed = await library.uploadGraphicAsset({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			bytes: createBoundedByteStream(transparentPixelPng, {
				byteLength: transparentPixelPng.byteLength,
				maximumByteLength: 16 * 1024 * 1024,
			}),
		});

		const updated = await library.updateGraphicAsset({
			assetId: completed.result!.assetId,
			name: 'Renamed logo',
			eventIds: [9, 11],
		});

		expect(updated).toMatchObject({
			id: completed.result?.assetId,
			name: 'Renamed logo',
			eventIds: [9, 11],
			revisionId: completed.result?.revisionId,
			revisionNumber: 1,
		});
		await expect(library.resolveGraphicAssetRevision({
			assetId: completed.result!.assetId,
			revisionId: completed.result!.revisionId,
		})).resolves.toMatchObject({ outcome: 'available' });
	});
});

// One case per ingestion entry-point family, proving the facade hands ingestion
// the catalogue and stores its discovery and delivery read. Ingestion's rules
// are held at its own seam: graphicsAssetIngestion*.sqlite.test.ts.
describe('each ingestion entry-point family wired into the Graphics Asset Library public module', () => {
	async function uploadPng(library: ReturnType<typeof createLibrary>['library'], idempotencyKey: string, name: string) {
		const operation = await library.initiateGraphicsIngestion({
			idempotencyKey,
			initiatedBy: 'graphics-author-1',
			name,
			declaredByteLength: transparentPixelPng.byteLength,
		});
		return await library.uploadGraphicAsset({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			bytes: boundedBytes(transparentPixelPng),
		});
	}

	it('publishes one uploaded PNG and discovers it with its exact operation result', async () => {
		const { library } = createLibrary();
		await addEvent(harness, 7);
		const operation = await library.initiateGraphicsIngestion({
			idempotencyKey: 'upload-scoreboard-logo',
			initiatedBy: 'graphics-author-1',
			name: 'Scoreboard logo',
			defaultEventId: 7,
			declaredByteLength: transparentPixelPng.byteLength,
		});
		await expect(library.listGraphicAssets({ search: '' })).resolves.toEqual([]);

		const completed = await library.uploadGraphicAsset({
			operationId: operation.id,
			initiatedBy: 'graphics-author-1',
			bytes: boundedBytes(transparentPixelPng),
		});

		expect(completed).toMatchObject({
			stage: 'completed',
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
				facts: acceptedReport(completed.report).facts,
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

	it('replaces Graphic Asset Content as a new Graphic Asset Revision and still delivers the one it superseded', async () => {
		const { library } = createLibrary();
		const original = await uploadPng(library, 'replacement-original', 'Replaceable logo');

		const replacement = await library.initiateGraphicAssetReplacement({
			assetId: original.result!.assetId,
			idempotencyKey: 'replacement-jpeg',
			initiatedBy: 'graphics-author-1',
			sourceFileName: 'replacement.jpg',
			declaredMime: 'image/jpeg',
			browserDecodeEvidence: {
				outcome: 'decoded',
				sourceDigest: digestOf(jpegPixel),
				width: 1,
				height: 1,
			},
			declaredByteLength: jpegPixel.byteLength,
		});
		const changed = await library.uploadGraphicAsset({
			operationId: replacement.id,
			initiatedBy: replacement.initiatedBy,
			declaredMime: 'image/jpeg',
			bytes: boundedBytes(jpegPixel),
		});

		expect(changed.result).toMatchObject({
			outcome: 'revision-created',
			assetId: original.result?.assetId,
		});
		await expect(library.listGraphicAssets({})).resolves.toEqual([
			expect.objectContaining({
				id: original.result?.assetId,
				name: 'Replaceable logo',
				revisionId: changed.result?.revisionId,
				revisionNumber: 2,
			}),
		]);
		await expect(library.resolveGraphicAssetRevision({
			assetId: original.result!.assetId,
			revisionId: original.result!.revisionId,
		})).resolves.toMatchObject({ outcome: 'available', contentType: 'image/png' });
		await expect(library.resolveGraphicAssetRevision({
			assetId: original.result!.assetId,
			revisionId: changed.result!.revisionId,
		})).resolves.toMatchObject({ outcome: 'available', contentType: 'image/jpeg' });
	});

	it('cancels an ingestion before publication', async () => {
		const { library } = createLibrary();
		const operation = await library.initiateGraphicsIngestion({
			idempotencyKey: 'cancelled-logo',
			initiatedBy: 'graphics-author-1',
			name: 'Cancelled logo',
			declaredByteLength: transparentPixelPng.byteLength,
		});

		const cancelled = await library.cancelGraphicsIngestion({
			operationId: operation.id,
			initiatedBy: 'graphics-author-1',
		});

		expect(cancelled).toMatchObject({
			stage: 'cancelled',
			failure: {
				code: 'ingestion-cancelled',
				retryable: false,
			},
		});
		await expect(library.listGraphicAssets({})).resolves.toEqual([]);
	});

	it('retries a failed ingestion from its staged bytes', async () => {
		const { library, canonical } = createLibrary();
		canonical.injectTransientFailure('create');
		const failed = await uploadPng(library, 'retry-logo', 'Retry logo');
		expect(failed).toMatchObject({
			stage: 'failed',
			failure: {
				code: 'canonical-store-unavailable',
				retryable: true,
			},
		});

		const completed = await library.retryGraphicsIngestion({
			operationId: failed.id,
			initiatedBy: 'graphics-author-1',
		});

		expect(completed).toMatchObject({
			stage: 'completed',
			result: { outcome: 'published' },
		});
		await expect(library.listGraphicAssets({ search: 'retry' })).resolves.toHaveLength(1);
	});
});
