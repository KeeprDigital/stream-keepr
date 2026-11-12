import type { GraphicAssetValidationReport, GraphicsIngestionOperation } from '~~/shared/types/graphicsAsset';
import type { SqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createD1GraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library/catalogue';
import {
	createInMemoryCanonicalGraphicsObjectStore,
	createInMemoryStagingGraphicsObjectStore,
} from '~~/server/modules/graphics-asset-library/in-memory-object-store';
import {
	createBoundedByteStream,
	unavailableObjectStoreOutcome,
} from '~~/server/modules/graphics-asset-library/object-store';
import { MAX_SILENT_VIDEO_POSTER_BYTES } from '~~/shared/utils/graphicsAssetCompatibility';
import { digestOf, sixteenPixelPng as sixteenPixelPosterPng, pixelPng as transparentPixelPng, vp9Webm } from '~~/test/helpers/graphicsFixtures';
import { jpegDeclaring, jpegPixel, webpDeclaring, webpPixel } from '~~/test/helpers/graphicsImageFixtures';
import {
	addEvent,
	canonicalIdentity,
	createTestGraphicsIngestion,
	publishedRevision,
	setCapacityLimits,
	storedGraphicAssets,
	storedRevisionContent,
} from '~~/test/helpers/graphicsLibrary';
import { callsTo } from '~~/test/helpers/lastCallTo';
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

function jpegSegment(marker: number, payload: Uint8Array) {
	const length = payload.byteLength + 2;
	return Uint8Array.of(0xFF, marker, length >>> 8, length & 0xFF, ...payload);
}

function jpegWithColourProfile() {
	const profile = jpegSegment(0xE2, new TextEncoder().encode('ICC_PROFILE\0'));
	return Uint8Array.of(...jpegPixel.subarray(0, 2), ...profile, ...jpegPixel.subarray(2));
}

function animatedWebp() {
	const payload = webpPixel.subarray(12);
	const riffLength = 4 + 8 + 10 + payload.byteLength;
	return Uint8Array.of(
		0x52,
		0x49,
		0x46,
		0x46,
		riffLength,
		0,
		0,
		0,
		0x57,
		0x45,
		0x42,
		0x50,
		0x56,
		0x50,
		0x38,
		0x58,
		10,
		0,
		0,
		0,
		0x02,
		0,
		0,
		0,
		0,
		0,
		0,
		0,
		0,
		0,
		...payload,
	);
}

function createIngestion(
	staging = createInMemoryStagingGraphicsObjectStore(),
	canonical = createInMemoryCanonicalGraphicsObjectStore(),
	catalogue = createD1GraphicsAssetCatalogue(harness.database),
	start = '2026-07-27T04:00:00.000Z',
	silentVideoPlaybackValidator?: {
		validate: (input: any) => Promise<any>;
	},
) {
	const context = createTestGraphicsIngestion({
		catalogue,
		staging,
		canonical,
		start,
		silentVideoPlaybackValidator,
	});
	const ingestion: typeof context.ingestion = {
		...context.ingestion,
		async initiateGraphicsIngestion(input) {
			const fixture = input.declaredMime === 'image/jpeg'
				? jpegPixel
				: input.declaredMime === 'image/webp'
					? webpPixel
					: transparentPixelPng;
			return await context.ingestion.initiateGraphicsIngestion({
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
	return { ...context, ingestion };
}

/** The active Graphic Assets publication stored, read from the catalogue's rows. */
async function storedAssets(search = '') {
	return await storedGraphicAssets({
		catalogue: createD1GraphicsAssetCatalogue(harness.database),
	}, search);
}

type Ingestion = ReturnType<typeof createIngestion>['ingestion'];

/** Upload `bytes` for `operation`, under an explicit stream allowance. */
async function uploadBytes(
	ingestion: Ingestion,
	operation: Pick<GraphicsIngestionOperation, 'id' | 'initiatedBy'>,
	declaredMime: Parameters<Ingestion['uploadGraphicAsset']>[0]['declaredMime'],
	bytes: Uint8Array,
	maximumByteLength: number,
) {
	return await ingestion.uploadGraphicAsset({
		operationId: operation.id,
		initiatedBy: operation.initiatedBy,
		declaredMime,
		bytes: createBoundedByteStream(bytes, { byteLength: bytes.byteLength, maximumByteLength }),
	});
}

describe('still-image ingestion at the Graphic Asset ingestion seam', () => {
	it.each([
		{
			label: 'missing browser evidence',
			browserDecodeEvidence: undefined,
			code: 'browser-image-decode-failed',
		},
		{
			label: 'browser decode rejection',
			browserDecodeEvidence: {
				outcome: 'rejected',
				sourceDigest: digestOf(jpegPixel),
			} as const,
			code: 'browser-image-decode-failed',
		},
		{
			label: 'browser evidence mismatch',
			browserDecodeEvidence: {
				outcome: 'decoded',
				sourceDigest: digestOf(jpegPixel),
				width: 2,
				height: 1,
			} as const,
			code: 'browser-image-decode-mismatch',
		},
	])('fails publication for $label', async ({
		browserDecodeEvidence,
		code,
	}) => {
		const { ingestion } = createIngestion();
		const operation = await ingestion.initiateGraphicsIngestion({
			idempotencyKey: `browser-gate-${code}`,
			initiatedBy: 'graphics-author-1',
			name: 'Browser-gated JPEG',
			sourceFileName: 'browser-gated.jpg',
			declaredMime: 'image/jpeg',
			browserDecodeEvidence,
			declaredByteLength: jpegPixel.byteLength,
		});

		const failed = await uploadBytes(ingestion, operation, 'image/jpeg', jpegPixel, 25 * 1024 * 1024);

		expect(failed).toMatchObject({
			stage: 'failed',
			report: {
				outcome: 'rejected',
				issues: [
					{ code },
				],
			},
			failure: { code: 'validation-failed', retryable: false },
		});
		await expect(storedAssets()).resolves.toEqual([]);
	});

	it.each([
		{
			format: 'jpeg',
			mime: 'image/jpeg',
			fileName: 'scoreboard.jpg',
			bytes: jpegPixel,
		},
		{
			format: 'webp',
			mime: 'image/webp',
			fileName: 'scoreboard.webp',
			bytes: webpPixel,
		},
	] as const)('publishes and stores exact $format source bytes', async ({
		format,
		mime,
		fileName,
		bytes,
	}) => {
		const { ingestion, catalogue, canonical } = createIngestion();
		const operation = await ingestion.initiateGraphicsIngestion({
			idempotencyKey: `upload-${format}`,
			initiatedBy: 'graphics-author-1',
			name: `${format} scoreboard`,
			sourceFileName: fileName,
			declaredMime: mime,
			declaredByteLength: bytes.byteLength,
		});

		const completed = await uploadBytes(ingestion, operation, mime, bytes, 25 * 1024 * 1024);

		expect(completed).toMatchObject({
			stage: 'completed',
			report: {
				outcome: 'accepted',
				compatibilityProfile: 'still-image-v1',
				facts: {
					format,
					canonicalMime: mime,
					frameCount: 1,
					orientation: 'normal',
				},
			},
			result: { outcome: 'published' },
		});
		await expect(storedRevisionContent({ catalogue, canonical }, publishedRevision(completed))).resolves.toEqual({
			contentType: mime,
			byteLength: bytes.byteLength,
			bytes,
		});
	});

	it('rejects conflicting initiation and transfer MIME declarations with a stable report', async () => {
		const { ingestion } = createIngestion();
		const operation = await ingestion.initiateGraphicsIngestion({
			idempotencyKey: 'conflicting-declared-mime',
			initiatedBy: 'graphics-author-1',
			name: 'Conflicting declaration',
			sourceFileName: 'scoreboard.png',
			declaredMime: 'image/jpeg',
			declaredByteLength: transparentPixelPng.byteLength,
		});

		const failed = await uploadBytes(ingestion, operation, 'image/png', transparentPixelPng, 25 * 1024 * 1024);

		expect(failed).toMatchObject({
			stage: 'failed',
			transferredByteLength: 0,
			report: {
				outcome: 'rejected',
				compatibilityProfile: 'still-image-v1',
				issues: [
					{ code: 'conflicting-image-mime' },
				],
			},
			failure: { code: 'validation-failed', retryable: false },
		});
	});

	// A MIME no profile accepts is still a declaration: it is held against the bytes, not dropped.
	it('rejects a declared MIME outside the accepted formats, declared the same way twice', async () => {
		const { ingestion } = createIngestion();
		const operation = await ingestion.initiateGraphicsIngestion({
			idempotencyKey: 'unaccepted-declared-mime',
			initiatedBy: 'graphics-author-1',
			name: 'Unaccepted declaration',
			sourceFileName: 'declared.png',
			declaredMime: 'image/gif',
			declaredByteLength: transparentPixelPng.byteLength,
		});

		const failed = await uploadBytes(ingestion, operation, 'image/gif', transparentPixelPng, 25 * 1024 * 1024);

		expect(failed).toMatchObject({
			stage: 'failed',
			report: {
				outcome: 'rejected',
				compatibilityProfile: 'still-image-v1',
				issues: [
					{ code: 'conflicting-image-mime' },
				],
			},
			failure: { code: 'validation-failed', retryable: false },
		});
		await expect(storedAssets()).resolves.toEqual([]);
	});

	it.each([
		{
			label: 'profiled JPEG',
			bytes: jpegWithColourProfile(),
			fileName: 'profiled.jpg',
			mime: 'image/jpeg',
			code: 'unsupported-jpeg-profile',
		},
		{
			label: 'animated WebP',
			bytes: animatedWebp(),
			fileName: 'animated.webp',
			mime: 'image/webp',
			code: 'unsupported-webp-animation',
		},
		{
			label: 'a JPEG over the full-decode pixel cap',
			bytes: jpegDeclaring(3840, 2161),
			fileName: 'too-large.jpg',
			mime: 'image/jpeg',
			code: 'image-pixels-exceeded',
		},
		{
			label: 'a WebP over the full-decode pixel cap',
			bytes: webpDeclaring(3840, 2161),
			fileName: 'too-large.webp',
			mime: 'image/webp',
			code: 'image-pixels-exceeded',
		},
	] as const)('reports a stable public validation result for $label', async ({
		bytes,
		fileName,
		mime,
		code,
	}) => {
		const { ingestion } = createIngestion();
		const operation = await ingestion.initiateGraphicsIngestion({
			idempotencyKey: `reject-${code}`,
			initiatedBy: 'graphics-author-1',
			name: fileName,
			sourceFileName: fileName,
			declaredMime: mime,
			declaredByteLength: bytes.byteLength,
		});

		const failed = await uploadBytes(ingestion, operation, mime, bytes, 25 * 1024 * 1024);

		expect(failed).toMatchObject({
			stage: 'failed',
			report: {
				outcome: 'rejected',
				compatibilityProfile: 'still-image-v1',
				issues: [
					{ code },
				],
			},
			failure: { code: 'validation-failed', retryable: false },
		});
	});

	it('durably publishes one validated PNG and stores it with its exact operation result', async () => {
		const { ingestion, catalogue, canonical } = createIngestion();
		await addEvent(harness, 7);
		const initiation = {
			idempotencyKey: 'upload-scoreboard-logo',
			initiatedBy: 'graphics-author-1',
			name: 'Scoreboard logo',
			defaultEventId: 7,
			declaredByteLength: transparentPixelPng.byteLength,
		};

		const operation = await ingestion.initiateGraphicsIngestion(initiation);
		const reconnected = await ingestion.initiateGraphicsIngestion(initiation);

		expect(operation).toMatchObject({
			stage: 'created',
			duplicateContentPolicy: 'reuse',
			transferredByteLength: 0,
			declaredByteLength: transparentPixelPng.byteLength,
		});
		expect(reconnected).toEqual(operation);
		await expect(storedAssets('')).resolves.toEqual([]);

		const completed = await ingestion.uploadGraphicAsset({
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
				compatibilityProfile: 'still-image-v1',
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

		await expect(ingestion.getIngestionOperation({
			operationId: operation.id,
			initiatedBy: 'graphics-author-1',
		})).resolves.toEqual(completed);

		await expect(storedAssets('scoreboard')).resolves.toEqual([
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

		const thumbnail = await catalogue.findThumbnailContent(completed.result!.assetId);
		if (!thumbnail)
			throw new Error('Expected the published thumbnail to be recorded');
		const preview = await canonical.read(canonicalIdentity(thumbnail.digest));
		if (preview.outcome !== 'available')
			throw new Error('Expected the published thumbnail to be stored');
		const previewBytes = new Uint8Array(await new Response(preview.body).arrayBuffer());
		expect(preview.object.contentType).toBe('image/png');
		expect(Array.from(previewBytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
	});

	it('streams staged source bytes into canonical storage without materializing the complete source', async () => {
		const stagingDelegate = createInMemoryStagingGraphicsObjectStore();
		const canonicalDelegate = createInMemoryCanonicalGraphicsObjectStore();
		let stagingReadCount = 0;
		let canonicalSourceFullyRead = false;
		let canonicalWriteStartedBeforeSourceFinished = false;
		const staging = {
			...stagingDelegate,
			async read(...input: Parameters<typeof stagingDelegate.read>) {
				const result = await stagingDelegate.read(...input);
				stagingReadCount++;
				if (
					result.outcome !== 'available'
					|| input[1] !== undefined
					|| stagingReadCount !== 4
				) {
					return result;
				}
				let offset = 0;
				return {
					...result,
					body: new ReadableStream<Uint8Array>({
						pull(controller) {
							if (offset >= transparentPixelPng.byteLength) {
								canonicalSourceFullyRead = true;
								controller.close();
								return;
							}
							const end = Math.min(offset + 7, transparentPixelPng.byteLength);
							controller.enqueue(transparentPixelPng.slice(offset, end));
							offset = end;
						},
					}),
				};
			},
		};
		const canonical = {
			...canonicalDelegate,
			async createImmutable(input: Parameters<typeof canonicalDelegate.createImmutable>[0]) {
				if (
					input.bytes.byteLength === transparentPixelPng.byteLength
					&& input.metadata?.custom?.sha256 === '431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460'
				) {
					canonicalWriteStartedBeforeSourceFinished = !canonicalSourceFullyRead;
				}
				return await canonicalDelegate.createImmutable(input);
			},
		};
		const { ingestion } = createIngestion(staging, canonical);
		const operation = await ingestion.initiateGraphicsIngestion({
			idempotencyKey: 'stream-canonical-source',
			initiatedBy: 'graphics-author-1',
			name: 'Streaming source',
			declaredByteLength: transparentPixelPng.byteLength,
		});

		const completed = await ingestion.uploadGraphicAsset({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			bytes: createBoundedByteStream(transparentPixelPng, {
				byteLength: transparentPixelPng.byteLength,
				maximumByteLength: 16 * 1024 * 1024,
			}),
		});

		expect(completed.stage).toBe('completed');
		expect(canonicalWriteStartedBeforeSourceFinished).toBe(true);
		expect(canonicalSourceFullyRead).toBe(true);
	});

	it('records permanent validation failure without publishing catalogue state', async () => {
		const { ingestion } = createIngestion();
		const invalidPng = new TextEncoder().encode('not a PNG');
		const operation = await ingestion.initiateGraphicsIngestion({
			idempotencyKey: 'invalid-logo',
			initiatedBy: 'graphics-author-1',
			name: 'Invalid logo',
			declaredByteLength: invalidPng.byteLength,
		});

		const failed = await ingestion.uploadGraphicAsset({
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
				compatibilityProfile: 'still-image-v1',
				issues: [
					{
						severity: 'error',
						code: 'unsupported-image-format',
					},
				],
			},
			failure: {
				code: 'validation-failed',
				retryable: false,
			},
		});
		await expect(storedAssets()).resolves.toEqual([]);
	});

	it('cancels idempotently before publication and never accepts later transfer bytes', async () => {
		const { ingestion } = createIngestion();
		const operation = await ingestion.initiateGraphicsIngestion({
			idempotencyKey: 'cancelled-logo',
			initiatedBy: 'graphics-author-1',
			name: 'Cancelled logo',
			declaredByteLength: transparentPixelPng.byteLength,
		});

		const cancelled = await ingestion.cancelGraphicsIngestion({
			operationId: operation.id,
			initiatedBy: 'graphics-author-1',
		});
		const cancelledAgain = await ingestion.cancelGraphicsIngestion({
			operationId: operation.id,
			initiatedBy: 'graphics-author-1',
		});
		const uploadAfterCancellation = await ingestion.uploadGraphicAsset({
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
		await expect(storedAssets()).resolves.toEqual([]);
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
		const { ingestion } = createIngestion(staging);
		const operation = await ingestion.initiateGraphicsIngestion({
			idempotencyKey: 'cancel-during-transfer',
			initiatedBy: 'graphics-author-1',
			name: 'Cancelled during transfer',
			declaredByteLength: transparentPixelPng.byteLength,
		});

		const upload = ingestion.uploadGraphicAsset({
			operationId: operation.id,
			initiatedBy: 'graphics-author-1',
			bytes: createBoundedByteStream(transparentPixelPng, {
				byteLength: transparentPixelPng.byteLength,
				maximumByteLength: 16 * 1024 * 1024,
			}),
		});
		await transferStarted;
		const cancelled = await ingestion.cancelGraphicsIngestion({
			operationId: operation.id,
			initiatedBy: 'graphics-author-1',
		});
		releaseTransfer();

		expect(cancelled.stage).toBe('cancelled');
		await expect(upload).resolves.toEqual(cancelled);
		await expect(storedAssets()).resolves.toEqual([]);
	});

	// A single-request transfer that staged nothing is recovered by sending the
	// bytes again, since no retry can resume from bytes that were never held.
	it.each([
		{
			interruption: 'staging answers unavailable',
			interrupt: async (): Promise<ReturnType<typeof unavailableObjectStoreOutcome>> => unavailableObjectStoreOutcome(),
			left: {
				stage: 'failed',
				failure: { code: 'staging-unavailable', retryable: true },
			},
		},
		{
			interruption: 'the transfer is interrupted',
			interrupt: async (): Promise<never> => {
				throw new Error('The request body was cancelled');
			},
			left: {
				stage: 'failed',
				failure: { code: 'staging-unavailable', retryable: true },
			},
		},
		{
			interruption: 'the request dies mid-transfer',
			interrupt: (): Promise<never> => new Promise(() => {}),
			left: { stage: 'transferring' },
		},
	])('accepts the bytes again after $interruption', async ({ interrupt, left }) => {
		const delegate = createInMemoryStagingGraphicsObjectStore();
		let interruptTransfer = true;
		const staging = {
			...delegate,
			async createImmutable(input: Parameters<typeof delegate.createImmutable>[0]) {
				if (!interruptTransfer)
					return await delegate.createImmutable(input);
				interruptTransfer = false;
				return await interrupt();
			},
		};
		const { ingestion } = createIngestion(staging);
		const operation = await ingestion.initiateGraphicsIngestion({
			idempotencyKey: 'interrupted-transfer',
			initiatedBy: 'graphics-author-1',
			name: 'Interrupted transfer',
			declaredByteLength: transparentPixelPng.byteLength,
		});
		const upload = () => uploadBytes(ingestion, operation, undefined, transparentPixelPng, 16 * 1024 * 1024);

		void upload().catch(() => {});
		await vi.waitFor(async () => {
			await expect(ingestion.getIngestionOperation({
				operationId: operation.id,
				initiatedBy: operation.initiatedBy,
			})).resolves.toMatchObject({ ...left, transferredByteLength: 0 });
		});

		await expect(upload()).resolves.toMatchObject({
			stage: 'completed',
			result: { outcome: 'published' },
		});
	});

	it('resumes from staged bytes after a retryable canonical-store failure', async () => {
		const { ingestion, canonical } = createIngestion();
		const operation = await ingestion.initiateGraphicsIngestion({
			idempotencyKey: 'retry-logo',
			initiatedBy: 'graphics-author-1',
			name: 'Retry logo',
			declaredByteLength: transparentPixelPng.byteLength,
		});
		canonical.injectTransientFailure('create');

		const failed = await ingestion.uploadGraphicAsset({
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

		// Staged bytes are held, so the way on is a retry and never a second transfer.
		await expect(uploadBytes(ingestion, operation, undefined, transparentPixelPng, 16 * 1024 * 1024))
			.rejects
			.toMatchObject({ code: 'ingestion-operation-not-uploadable' });

		const completed = await ingestion.retryGraphicsIngestion({
			operationId: operation.id,
			initiatedBy: 'graphics-author-1',
		});
		expect(completed).toMatchObject({
			stage: 'completed',
			result: { outcome: 'published' },
		});
		await expect(storedAssets('retry')).resolves.toHaveLength(1);
	});

	it('reuses an existing Graphic Asset for ordinary duplicate content', async () => {
		const { ingestion } = createIngestion();
		await Promise.all([7, 9].map(eventId => addEvent(harness, eventId)));

		async function ingest(idempotencyKey: string, name: string, defaultEventId: number) {
			const operation = await ingestion.initiateGraphicsIngestion({
				idempotencyKey,
				initiatedBy: 'graphics-author-1',
				name,
				defaultEventId,
				declaredByteLength: transparentPixelPng.byteLength,
			});
			return await ingestion.uploadGraphicAsset({
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
		await expect(storedAssets('')).resolves.toEqual([
			expect.objectContaining({
				id: published.result?.assetId,
				name: 'Original logo',
				eventIds: [7, 9],
				operation: reused,
			}),
		]);
	});

	it('publishes a separate Graphic Asset when duplicate content reuse is explicitly disabled', async () => {
		const { ingestion } = createIngestion();

		async function ingest(idempotencyKey: string, duplicateContentPolicy: 'reuse' | 'create-separate') {
			const operation = await ingestion.initiateGraphicsIngestion({
				idempotencyKey,
				initiatedBy: 'graphics-author-1',
				name: idempotencyKey,
				duplicateContentPolicy,
				declaredByteLength: transparentPixelPng.byteLength,
			});
			return await ingestion.uploadGraphicAsset({
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
		await expect(storedAssets()).resolves.toHaveLength(2);
	});

	it('replaces Graphic Asset Content as immutable Graphic Asset Revisions while current Graphic Asset Content is a no-op', async () => {
		const { ingestion, catalogue, canonical } = createIngestion();
		const originalOperation = await ingestion.initiateGraphicsIngestion({
			idempotencyKey: 'replacement-original',
			initiatedBy: 'graphics-author-1',
			name: 'Replaceable logo',
			declaredByteLength: transparentPixelPng.byteLength,
		});
		const original = await ingestion.uploadGraphicAsset({
			operationId: originalOperation.id,
			initiatedBy: originalOperation.initiatedBy,
			bytes: createBoundedByteStream(transparentPixelPng, {
				byteLength: transparentPixelPng.byteLength,
				maximumByteLength: 16 * 1024 * 1024,
			}),
		});

		async function replace(
			idempotencyKey: string,
			bytes: Uint8Array,
			declaredMime: 'image/png' | 'image/jpeg',
		) {
			const operation = await ingestion.initiateGraphicAssetReplacement({
				assetId: original.result!.assetId,
				idempotencyKey,
				initiatedBy: 'graphics-author-1',
				sourceFileName: `replacement.${declaredMime === 'image/png'
					? 'png'
					: 'jpg'}`,
				declaredMime,
				browserDecodeEvidence: {
					outcome: 'decoded',
					sourceDigest: digestOf(bytes),
					width: 1,
					height: 1,
				},
				declaredByteLength: bytes.byteLength,
			});
			return await ingestion.uploadGraphicAsset({
				operationId: operation.id,
				initiatedBy: operation.initiatedBy,
				declaredMime,
				bytes: createBoundedByteStream(bytes, {
					byteLength: bytes.byteLength,
					maximumByteLength: 16 * 1024 * 1024,
				}),
			});
		}

		const changed = await replace('replacement-jpeg', jpegPixel, 'image/jpeg');
		expect(changed.result).toMatchObject({
			outcome: 'revision-created',
			assetId: original.result?.assetId,
		});
		expect(changed.result?.revisionId).not.toBe(original.result?.revisionId);

		const unchanged = await replace('replacement-jpeg-no-op', jpegPixel, 'image/jpeg');
		expect(unchanged.result).toEqual({
			outcome: 'replacement-noop',
			assetId: original.result?.assetId,
			revisionId: changed.result?.revisionId,
		});

		const restored = await replace('replacement-original-again', transparentPixelPng, 'image/png');
		expect(restored.result).toMatchObject({
			outcome: 'revision-created',
			assetId: original.result?.assetId,
		});
		expect(restored.result?.revisionId).not.toBe(original.result?.revisionId);
		expect(restored.result?.revisionId).not.toBe(changed.result?.revisionId);

		await expect(storedAssets()).resolves.toEqual([
			expect.objectContaining({
				id: original.result?.assetId,
				name: 'Replaceable logo',
				revisionId: restored.result?.revisionId,
				revisionNumber: 3,
			}),
		]);
		await expect(storedRevisionContent({ catalogue, canonical }, publishedRevision(original)))
			.resolves
			.toMatchObject({ contentType: 'image/png' });
		await expect(storedRevisionContent({ catalogue, canonical }, publishedRevision(changed)))
			.resolves
			.toMatchObject({ contentType: 'image/jpeg' });
	});

	it('publishes concurrent identical replacement content as one Graphic Asset Revision', async () => {
		const delegate = createD1GraphicsAssetCatalogue(harness.database);
		let publishingArrivals = 0;
		let releasePublishing!: () => void;
		const bothPublishing = new Promise<void>((resolve) => {
			releasePublishing = resolve;
		});
		const catalogue = {
			...delegate,
			async publishGraphicAssetReplacement(
				input: Parameters<typeof delegate.publishGraphicAssetReplacement>[0],
			) {
				publishingArrivals += 1;
				if (publishingArrivals === 2)
					releasePublishing();
				await bothPublishing;
				return await delegate.publishGraphicAssetReplacement(input);
			},
		};
		const { ingestion } = createIngestion(
			createInMemoryStagingGraphicsObjectStore(),
			createInMemoryCanonicalGraphicsObjectStore(),
			catalogue,
		);
		const originalOperation = await ingestion.initiateGraphicsIngestion({
			idempotencyKey: 'concurrent-replacement-original',
			initiatedBy: 'graphics-author-1',
			name: 'Concurrently replaced logo',
			declaredByteLength: transparentPixelPng.byteLength,
		});
		const original = await ingestion.uploadGraphicAsset({
			operationId: originalOperation.id,
			initiatedBy: originalOperation.initiatedBy,
			bytes: createBoundedByteStream(transparentPixelPng, {
				byteLength: transparentPixelPng.byteLength,
				maximumByteLength: 16 * 1024 * 1024,
			}),
		});

		const replacements = await Promise.all(
			['concurrent-replacement-a', 'concurrent-replacement-b'].map(
				async idempotencyKey => await ingestion.initiateGraphicAssetReplacement({
					assetId: original.result!.assetId,
					idempotencyKey,
					initiatedBy: 'graphics-author-1',
					sourceFileName: `${idempotencyKey}.jpg`,
					declaredMime: 'image/jpeg',
					browserDecodeEvidence: {
						outcome: 'decoded',
						sourceDigest: digestOf(jpegPixel),
						width: 1,
						height: 1,
					},
					declaredByteLength: jpegPixel.byteLength,
				}),
			),
		);
		const completed = await Promise.all(replacements.map(
			async operation => await uploadBytes(ingestion, operation, 'image/jpeg', jpegPixel, 16 * 1024 * 1024),
		));

		expect(completed.map(operation => operation.result?.outcome).sort()).toEqual([
			'replacement-noop',
			'revision-created',
		]);
		expect(new Set(completed.map(operation => operation.result?.revisionId)).size).toBe(1);
		await expect(storedAssets()).resolves.toEqual([
			expect.objectContaining({
				id: original.result?.assetId,
				revisionId: completed[0]!.result?.revisionId,
				revisionNumber: 2,
			}),
		]);
	});

	it('rejects a stale replacement no-op and creates a Graphic Asset Revision when retried', async () => {
		const delegate = createD1GraphicsAssetCatalogue(harness.database);
		let signalNoopStarted!: () => void;
		const noopStarted = new Promise<void>((resolve) => {
			signalNoopStarted = resolve;
		});
		let releaseNoop!: () => void;
		const noopMayComplete = new Promise<void>((resolve) => {
			releaseNoop = resolve;
		});
		let pauseNoop = true;
		const catalogue = {
			...delegate,
			async completeGraphicAssetReplacementNoop(
				input: Parameters<typeof delegate.completeGraphicAssetReplacementNoop>[0],
			) {
				if (pauseNoop) {
					signalNoopStarted();
					await noopMayComplete;
				}
				return await delegate.completeGraphicAssetReplacementNoop(input);
			},
		};
		const { ingestion } = createIngestion(
			createInMemoryStagingGraphicsObjectStore(),
			createInMemoryCanonicalGraphicsObjectStore(),
			catalogue,
		);
		const originalOperation = await ingestion.initiateGraphicsIngestion({
			idempotencyKey: 'stale-noop-original',
			initiatedBy: 'graphics-author-1',
			name: 'Stale no-op logo',
			declaredByteLength: transparentPixelPng.byteLength,
		});
		const original = await ingestion.uploadGraphicAsset({
			operationId: originalOperation.id,
			initiatedBy: originalOperation.initiatedBy,
			bytes: createBoundedByteStream(transparentPixelPng, {
				byteLength: transparentPixelPng.byteLength,
				maximumByteLength: 16 * 1024 * 1024,
			}),
		});

		async function replacementOperation(
			idempotencyKey: string,
			bytes: Uint8Array,
			declaredMime: 'image/png' | 'image/jpeg',
		) {
			return await ingestion.initiateGraphicAssetReplacement({
				assetId: original.result!.assetId,
				idempotencyKey,
				initiatedBy: 'graphics-author-1',
				sourceFileName: `${idempotencyKey}.${declaredMime === 'image/png'
					? 'png'
					: 'jpg'}`,
				declaredMime,
				browserDecodeEvidence: {
					outcome: 'decoded',
					sourceDigest: digestOf(bytes),
					width: 1,
					height: 1,
				},
				declaredByteLength: bytes.byteLength,
			});
		}

		const staleNoop = await replacementOperation(
			'stale-noop-current-content',
			transparentPixelPng,
			'image/png',
		);
		const staleCompletion = uploadBytes(ingestion, staleNoop, 'image/png', transparentPixelPng, 16 * 1024 * 1024);
		await noopStarted;

		const changed = await replacementOperation(
			'stale-noop-intervening-content',
			jpegPixel,
			'image/jpeg',
		);
		const changedCompletion = await uploadBytes(ingestion, changed, 'image/jpeg', jpegPixel, 16 * 1024 * 1024);
		expect(changedCompletion.result?.outcome).toBe('revision-created');

		pauseNoop = false;
		releaseNoop();
		const failedStaleNoop = await staleCompletion;
		expect(failedStaleNoop).toMatchObject({
			stage: 'failed',
			failure: {
				code: 'catalogue-publication-failed',
				retryable: true,
			},
		});

		const retried = await ingestion.retryGraphicsIngestion({
			operationId: staleNoop.id,
			initiatedBy: staleNoop.initiatedBy,
		});
		expect(retried).toMatchObject({
			stage: 'completed',
			result: {
				outcome: 'revision-created',
				assetId: original.result?.assetId,
			},
		});
		await expect(storedAssets()).resolves.toEqual([
			expect.objectContaining({
				revisionId: retried.result?.revisionId,
				revisionNumber: 3,
			}),
		]);
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
		const { ingestion } = createIngestion(createInMemoryStagingGraphicsObjectStore(), canonical);
		const operation = await ingestion.initiateGraphicsIngestion({
			idempotencyKey: 'corrupt-canonical-logo',
			initiatedBy: 'graphics-author-1',
			name: 'Corrupt canonical logo',
			declaredByteLength: transparentPixelPng.byteLength,
		});

		const failed = await ingestion.uploadGraphicAsset({
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
		await expect(storedAssets()).resolves.toEqual([]);
	});

	it('atomically reuses content when two ordinary ingestions publish concurrently', async () => {
		const delegate = createD1GraphicsAssetCatalogue(harness.database);
		let reusableLookups = 0;
		let releaseLookups!: () => void;
		const bothLooking = new Promise<void>((resolve) => {
			releaseLookups = resolve;
		});
		const catalogue = {
			...delegate,
			async findReusableGraphicAsset(sourceDigest: string) {
				reusableLookups++;
				if (reusableLookups === 2)
					releaseLookups();
				await bothLooking;
				return await delegate.findReusableGraphicAsset(sourceDigest);
			},
		};
		const { ingestion } = createIngestion(
			createInMemoryStagingGraphicsObjectStore(),
			createInMemoryCanonicalGraphicsObjectStore(),
			catalogue,
		);
		const operations = await Promise.all([
			ingestion.initiateGraphicsIngestion({
				idempotencyKey: 'concurrent-a',
				initiatedBy: 'graphics-author-1',
				name: 'Concurrent A',
				declaredByteLength: transparentPixelPng.byteLength,
			}),
			ingestion.initiateGraphicsIngestion({
				idempotencyKey: 'concurrent-b',
				initiatedBy: 'graphics-author-1',
				name: 'Concurrent B',
				declaredByteLength: transparentPixelPng.byteLength,
			}),
		]);
		const completed = await Promise.all(operations.map(operation => ingestion.uploadGraphicAsset({
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
		await expect(storedAssets()).resolves.toHaveLength(1);
	});

	it('honours cancellation after entering publishing but before catalogue publication', async () => {
		const delegate = createD1GraphicsAssetCatalogue(harness.database);
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
			async publishGraphicAsset(input: Parameters<typeof delegate.publishGraphicAsset>[0]) {
				publicationStarted();
				await released;
				return await delegate.publishGraphicAsset(input);
			},
		};
		const { ingestion } = createIngestion(
			createInMemoryStagingGraphicsObjectStore(),
			createInMemoryCanonicalGraphicsObjectStore(),
			catalogue,
		);
		const operation = await ingestion.initiateGraphicsIngestion({
			idempotencyKey: 'cancel-before-publication',
			initiatedBy: 'graphics-author-1',
			name: 'Cancelled before publication',
			declaredByteLength: transparentPixelPng.byteLength,
		});
		const upload = ingestion.uploadGraphicAsset({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			bytes: createBoundedByteStream(transparentPixelPng, {
				byteLength: transparentPixelPng.byteLength,
				maximumByteLength: 16 * 1024 * 1024,
			}),
		});
		await started;
		const cancelled = await ingestion.cancelGraphicsIngestion({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
		});
		releasePublication();

		expect(cancelled.stage).toBe('cancelled');
		await expect(upload).resolves.toEqual(cancelled);
		await expect(storedAssets()).resolves.toEqual([]);
	});

	// One active attempt per operation: a retry takes a working operation only
	// once its last write is a whole lease old, and the attempt it displaced
	// publishes nothing.
	it('refuses a retry while another attempt holds the operation, and takes it once that lease lapses', async () => {
		const delegate = createD1GraphicsAssetCatalogue(harness.database);
		let publications = 0;
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
			async publishGraphicAsset(input: Parameters<typeof delegate.publishGraphicAsset>[0]) {
				if (publications++ === 0) {
					publicationStarted();
					await released;
				}
				return await delegate.publishGraphicAsset(input);
			},
		};
		const { ingestion, lifecycle, advanceTo } = createIngestion(
			createInMemoryStagingGraphicsObjectStore(),
			createInMemoryCanonicalGraphicsObjectStore(),
			catalogue,
		);
		const operation = await ingestion.initiateGraphicsIngestion({
			idempotencyKey: 'leased-attempt',
			initiatedBy: 'graphics-author-1',
			name: 'Leased attempt',
			declaredByteLength: transparentPixelPng.byteLength,
		});
		const working = uploadBytes(ingestion, operation, undefined, transparentPixelPng, 16 * 1024 * 1024);
		await started;
		const held = await ingestion.getIngestionOperation({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
		});
		const lastWrite = new Date(held.updatedAt).getTime();
		const retry = () => ingestion.retryGraphicsIngestion({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
		});

		advanceTo(new Date(lastWrite + lifecycle.activeIngestionLeaseMilliseconds - 1).toISOString());
		await expect(retry()).rejects.toMatchObject({ code: 'ingestion-operation-lease-held' });

		advanceTo(new Date(lastWrite + lifecycle.activeIngestionLeaseMilliseconds).toISOString());
		const retried = await retry();
		expect(retried).toMatchObject({
			stage: 'completed',
			result: { outcome: 'published' },
		});

		releasePublication();
		await expect(working).resolves.toEqual(retried);
		await expect(storedAssets()).resolves.toHaveLength(1);
	});

	it('fences a displaced processor after a stale operation is claimed', async () => {
		const { ingestion, catalogue } = createIngestion();
		const created = await ingestion.initiateGraphicsIngestion({
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
		const claimed = await catalogue.claimGraphicsIngestion({
			operation: transferring,
			claimedAt: '2026-07-27T04:01:00.000Z',
			staleBefore: '2026-07-27T04:00:30.000Z',
		});

		expect(claimed?.stage).toBe('hashing');
		await expect(catalogue.updateIngestionOperation({
			...transferring,
			stage: 'validating',
			updatedAt: '2026-07-27T04:01:01.000Z',
		}, transferring.updatedAt)).rejects.toThrow('lost its durable transition');
	});
});

describe('silent-video ingestion at the Graphic Asset ingestion seam', () => {
	it('publishes only from trusted operation/source/facts-bound playback validation', async () => {
		const validate = vi.fn(async (input: any) => ({
			outcome: 'accepted',
			operationId: input.operationId,
			idempotencyKey: input.idempotencyKey,
			sourceDigest: input.sourceDigest,
			factsDigest: input.factsDigest,
			width: input.inspectedFacts.width,
			height: input.inspectedFacts.height,
			durationSeconds: input.inspectedFacts.durationSeconds,
			posterTimeSeconds: input.inspectedFacts.posterTimeSeconds,
			mutedInlinePlayback: true,
			seeked: true,
			transparencyRendered: false,
			posterDigest: digestOf(sixteenPixelPosterPng),
			poster: createBoundedByteStream(sixteenPixelPosterPng, {
				byteLength: sixteenPixelPosterPng.byteLength,
				maximumByteLength: MAX_SILENT_VIDEO_POSTER_BYTES,
			}),
		}));
		const { ingestion } = createIngestion(
			undefined,
			undefined,
			undefined,
			undefined,
			{ validate },
		);
		const initiated = await ingestion.initiateGraphicsIngestion({
			idempotencyKey: 'trusted-video-runtime',
			initiatedBy: 'graphics-author-1',
			name: 'Trusted VP9',
			sourceFileName: 'trusted.webm',
			declaredMime: 'video/webm',
			declaredByteLength: vp9Webm.byteLength,
		});

		const completed = await uploadBytes(ingestion, initiated, 'video/webm', vp9Webm, 250 * 1024 * 1024);

		expect(completed).toMatchObject({
			stage: 'completed',
			report: {
				outcome: 'accepted',
				facts: { browserPlayable: true },
			},
		});
		expect(validate).toHaveBeenCalledOnce();
		expect(validate).toHaveBeenCalledWith(expect.objectContaining({
			operationId: initiated.id,
			sourceDigest: digestOf(vp9Webm),
			inspectedFacts: expect.objectContaining({
				sha256: digestOf(vp9Webm),
				format: 'webm',
				codec: 'vp9',
			}),
			factsDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
			idempotencyKey: expect.stringContaining(initiated.id),
		}));
	});

	it('fails retryably closed when the trusted playback runtime is unavailable', async () => {
		const { ingestion } = createIngestion();
		const initiated = await ingestion.initiateGraphicsIngestion({
			idempotencyKey: 'missing-video-runtime',
			initiatedBy: 'graphics-author-1',
			name: 'No runtime VP9',
			sourceFileName: 'missing-runtime.webm',
			declaredMime: 'video/webm',
			declaredByteLength: vp9Webm.byteLength,
		});

		const failed = await uploadBytes(ingestion, initiated, 'video/webm', vp9Webm, 250 * 1024 * 1024);

		expect(failed).toMatchObject({
			stage: 'failed',
			failure: {
				code: 'validation-runtime-unavailable',
				retryable: true,
			},
		});
		await expect(storedAssets()).resolves.toEqual([]);
	});

	it('reuses the exact validation idempotency binding after a retryable runtime failure', async () => {
		const accepted = (input: any) => ({
			outcome: 'accepted',
			operationId: input.operationId,
			idempotencyKey: input.idempotencyKey,
			sourceDigest: input.sourceDigest,
			factsDigest: input.factsDigest,
			width: input.inspectedFacts.width,
			height: input.inspectedFacts.height,
			durationSeconds: input.inspectedFacts.durationSeconds,
			posterTimeSeconds: input.inspectedFacts.posterTimeSeconds,
			mutedInlinePlayback: true,
			seeked: true,
			transparencyRendered: false,
			posterDigest: digestOf(sixteenPixelPosterPng),
			poster: createBoundedByteStream(sixteenPixelPosterPng, {
				byteLength: sixteenPixelPosterPng.byteLength,
				maximumByteLength: MAX_SILENT_VIDEO_POSTER_BYTES,
			}),
		});
		const validate = vi.fn()
			.mockResolvedValueOnce({ outcome: 'unavailable', retryable: true })
			.mockImplementation(async input => accepted(input));
		const { ingestion } = createIngestion(
			undefined,
			undefined,
			undefined,
			undefined,
			{ validate },
		);
		const initiated = await ingestion.initiateGraphicsIngestion({
			idempotencyKey: 'trusted-video-retry',
			initiatedBy: 'graphics-author-1',
			name: 'Retry trusted VP9',
			sourceFileName: 'retry.webm',
			declaredMime: 'video/webm',
			declaredByteLength: vp9Webm.byteLength,
		});
		const first = await uploadBytes(ingestion, initiated, 'video/webm', vp9Webm, 250 * 1024 * 1024);
		expect(first).toMatchObject({
			stage: 'failed',
			failure: { code: 'validation-runtime-unavailable', retryable: true },
		});

		const completed = await ingestion.retryGraphicsIngestion({
			operationId: initiated.id,
			initiatedBy: initiated.initiatedBy,
		});
		expect(completed.stage).toBe('completed');
		// Two attempts, counted where they are read rather than a line or two above it,
		// because the retry's whole subject is its relationship to the first attempt. This
		// is the destructure-the-mapped-list shape `callsTo`'s docblock names second: the
		// count is refused before either name is bound, so neither read can be the empty
		// case that made the same comparison pass vacuously in #330.
		const [firstAttempt, retriedAttempt] = callsTo(validate, 2).map(([input]) => input);
		expect(retriedAttempt).toMatchObject({
			operationId: firstAttempt.operationId,
			idempotencyKey: firstAttempt.idempotencyKey,
			sourceDigest: firstAttempt.sourceDigest,
			factsDigest: firstAttempt.factsDigest,
		});
	});

	it('fails retryably closed for a trusted result bound to a different source', async () => {
		const validate = vi.fn(async (input: any) => ({
			outcome: 'accepted',
			operationId: input.operationId,
			idempotencyKey: input.idempotencyKey,
			sourceDigest: '0'.repeat(64),
			factsDigest: input.factsDigest,
			width: 16,
			height: 16,
			durationSeconds: 1,
			posterTimeSeconds: 0.1,
			mutedInlinePlayback: true,
			seeked: true,
			transparencyRendered: false,
			posterDigest: digestOf(sixteenPixelPosterPng),
			poster: createBoundedByteStream(sixteenPixelPosterPng, {
				byteLength: sixteenPixelPosterPng.byteLength,
				maximumByteLength: MAX_SILENT_VIDEO_POSTER_BYTES,
			}),
		}));
		const { ingestion } = createIngestion(
			undefined,
			undefined,
			undefined,
			undefined,
			{ validate },
		);
		const initiated = await ingestion.initiateGraphicsIngestion({
			idempotencyKey: 'misbound-trusted-video',
			initiatedBy: 'graphics-author-1',
			name: 'Misbound trusted VP9',
			sourceFileName: 'misbound.webm',
			declaredMime: 'video/webm',
			declaredByteLength: vp9Webm.byteLength,
		});
		const failed = await uploadBytes(ingestion, initiated, 'video/webm', vp9Webm, 250 * 1024 * 1024);
		expect(failed).toMatchObject({
			stage: 'failed',
			failure: { code: 'validation-runtime-unavailable', retryable: true },
		});
	});

	it('maps a trusted adapter execution fault to retryable runtime unavailability', async () => {
		const { ingestion } = createIngestion(
			undefined,
			undefined,
			undefined,
			undefined,
			{
				async validate() {
					throw new Error('validation service disconnected');
				},
			},
		);
		const initiated = await ingestion.initiateGraphicsIngestion({
			idempotencyKey: 'faulting-trusted-video',
			initiatedBy: 'graphics-author-1',
			name: 'Faulting trusted VP9',
			sourceFileName: 'fault.webm',
			declaredMime: 'video/webm',
			declaredByteLength: vp9Webm.byteLength,
		});
		const failed = await uploadBytes(ingestion, initiated, 'video/webm', vp9Webm, 250 * 1024 * 1024);

		expect(failed).toMatchObject({
			stage: 'failed',
			failure: { code: 'validation-runtime-unavailable', retryable: true },
		});
	});

	it('fails retryably closed when the trusted runtime returns an invalid poster', async () => {
		const invalidPoster = Uint8Array.of(1, 2, 3);
		const { ingestion } = createIngestion(
			undefined,
			undefined,
			undefined,
			undefined,
			{
				async validate(input) {
					return {
						outcome: 'accepted',
						operationId: input.operationId,
						idempotencyKey: input.idempotencyKey,
						sourceDigest: input.sourceDigest,
						factsDigest: input.factsDigest,
						width: input.inspectedFacts.width,
						height: input.inspectedFacts.height,
						durationSeconds: input.inspectedFacts.durationSeconds,
						posterTimeSeconds: input.inspectedFacts.posterTimeSeconds,
						mutedInlinePlayback: true,
						seeked: true,
						transparencyRendered: false,
						posterDigest: digestOf(invalidPoster),
						poster: createBoundedByteStream(invalidPoster, {
							byteLength: invalidPoster.byteLength,
							maximumByteLength: MAX_SILENT_VIDEO_POSTER_BYTES,
						}),
					};
				},
			},
		);
		const initiated = await ingestion.initiateGraphicsIngestion({
			idempotencyKey: 'invalid-trusted-poster',
			initiatedBy: 'graphics-author-1',
			name: 'Invalid trusted poster',
			sourceFileName: 'invalid-poster.webm',
			declaredMime: 'video/webm',
			declaredByteLength: vp9Webm.byteLength,
		});
		const failed = await uploadBytes(ingestion, initiated, 'video/webm', vp9Webm, 250 * 1024 * 1024);

		expect(failed).toMatchObject({
			stage: 'failed',
			failure: { code: 'validation-runtime-unavailable', retryable: true },
		});
	});

	it('permanently rejects a trusted playback or seek failure', async () => {
		const validate = vi.fn(async (input: any) => ({
			outcome: 'rejected',
			operationId: input.operationId,
			idempotencyKey: input.idempotencyKey,
			sourceDigest: input.sourceDigest,
			factsDigest: input.factsDigest,
			stage: 'seek',
		}));
		const { ingestion } = createIngestion(
			undefined,
			undefined,
			undefined,
			undefined,
			{ validate },
		);
		const initiated = await ingestion.initiateGraphicsIngestion({
			idempotencyKey: 'trusted-video-rejected',
			initiatedBy: 'graphics-author-1',
			name: 'Rejected trusted VP9',
			sourceFileName: 'rejected.webm',
			declaredMime: 'video/webm',
			declaredByteLength: vp9Webm.byteLength,
		});
		const failed = await uploadBytes(ingestion, initiated, 'video/webm', vp9Webm, 250 * 1024 * 1024);
		expect(failed).toMatchObject({
			stage: 'failed',
			report: {
				outcome: 'rejected',
				issues: [
					{ code: 'browser-video-playback-failed' },
				],
			},
			failure: { code: 'validation-failed', retryable: false },
		});
	});

	it('reserves the poster envelope in the Graphics Staging Allowance', async () => {
		const { ingestion, catalogue, now } = createIngestion();
		const { canonical, staging } = await catalogue.getCapacity();
		await setCapacityLimits({ catalogue, now }, {
			canonicalLimitBytes: canonical.limitBytes,
			stagingLimitBytes: vp9Webm.byteLength + MAX_SILENT_VIDEO_POSTER_BYTES - 1,
		});
		await expect(ingestion.initiateGraphicsIngestion({
			idempotencyKey: 'vp9-poster-capacity-blocked',
			initiatedBy: 'graphics-author-1',
			name: 'VP9 poster capacity',
			sourceFileName: 'ident.webm',
			declaredMime: 'video/webm',
			declaredByteLength: vp9Webm.byteLength,
		})).rejects.toMatchObject({
			code: 'staging-capacity-exhausted',
			capacity: {
				requestedBytes: vp9Webm.byteLength + MAX_SILENT_VIDEO_POSTER_BYTES,
			},
		});

		await setCapacityLimits({ catalogue, now }, {
			canonicalLimitBytes: canonical.limitBytes,
			stagingLimitBytes: staging.limitBytes,
		});
		const initiated = await ingestion.initiateGraphicsIngestion({
			idempotencyKey: 'vp9-poster-capacity-accounted',
			initiatedBy: 'graphics-author-1',
			name: 'VP9 poster accounted',
			sourceFileName: 'ident.webm',
			declaredMime: 'video/webm',
			declaredByteLength: vp9Webm.byteLength,
		});
		await expect(catalogue.getCapacity()).resolves.toMatchObject({
			staging: {
				usedBytes: 0,
				reservedBytes: vp9Webm.byteLength + MAX_SILENT_VIDEO_POSTER_BYTES,
			},
		});
		await uploadBytes(ingestion, initiated, 'video/webm', vp9Webm, 250 * 1024 * 1024);
		await expect(catalogue.getCapacity()).resolves.toMatchObject({
			staging: {
				usedBytes: vp9Webm.byteLength,
				reservedBytes: MAX_SILENT_VIDEO_POSTER_BYTES,
			},
		});
	});
});
