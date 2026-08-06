import type { GraphicAssetValidationReport } from '~~/shared/types/graphicsAsset';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
	createGraphicsAssetLibrary,
	createInMemoryGraphicsAssetCatalogue,
	graphicAssetRevisionId,
} from '~~/server/modules/graphics-asset-library';
import {
	createInMemoryCanonicalGraphicsObjectStore,
	createInMemoryStagingGraphicsObjectStore,
} from '~~/server/modules/graphics-asset-library/in-memory-object-store';
import {
	consumeBoundedByteStream,
	createBoundedByteStream,
	graphicsObjectIdentity,
} from '~~/server/modules/graphics-asset-library/object-store';
import { MAX_SILENT_VIDEO_POSTER_BYTES } from '~~/shared/utils/graphicsAssetCompatibility';

const transparentPixelPng = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
));
const sixteenPixelPosterPng = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAHUlEQVR4nGP8x8Dwn4ECwEKJ5lEDRg0YNWAwGQAAkU4CO63xbeIAAAAASUVORK5CYII=',
	'base64',
));
const jpegPixel = Uint8Array.from(Buffer.from(
	'/9j/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJtAEx7/2Q==',
	'base64',
));
const webpPixel = Uint8Array.from(Buffer.from(
	'UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAEAdQlFKUp4CBiOh/AAA=',
	'base64',
));
const vp9Webm = Uint8Array.from(Buffer.from(
	'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAIMEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggElTbuMU6uEHFO7a1OsggH27AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjIuMTIuMTAyV0GNTGF2ZjYyLjEyLjEwMkSJiECPQAAAAAAAFlSua8iuAQAAAAAAAD/XgQFzxYhkRqj8GKbqBJyBACK1nIN1bmSIgQCGhVZfVlA5g4EBI+ODhB3NZQDgkLCBELqBEJqBAlWwhFW5gQESVMNnQIBzc6BjwIBnyJpFo4dFTkNPREVSRIeNTGF2ZjYyLjEyLjEwMnNz2mPAi2PFiGRGqPwYpuoEZ8ilRaOHRU5DT0RFUkSHmExhdmM2Mi4yOC4xMDIgbGlidnB4LXZwOWfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDEuMDAwMDAwMDAwAB9DtnXG54EAo6yBAACAgkmDQgAA8AD2ADgkHBhCAAAwcAAASqf/+5CBv///CAg////7iYcAAKOTgQH0AIYAQJKcAElAAAMgAABCQBxTu2uRu4+zgQC3iveBAfGCAavwgQM=',
	'base64',
));

// Only an accepted validation report carries facts, so a reading of them has
// to say which outcome it expected rather than assume one.
function acceptedReport(report: GraphicAssetValidationReport | undefined) {
	if (report?.outcome !== 'accepted')
		throw new Error(`expected an accepted validation report, got ${report?.outcome ?? 'none'}`);
	return report;
}

function sourceDigest(bytes: Uint8Array) {
	return createHash('sha256').update(bytes).digest('hex');
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

function createLibrary(
	staging = createInMemoryStagingGraphicsObjectStore(),
	canonical = createInMemoryCanonicalGraphicsObjectStore(),
	catalogue = createInMemoryGraphicsAssetCatalogue(),
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
								sourceDigest: sourceDigest(fixture),
								width: 1,
								height: 1,
							},
			});
		},
	};
	return { library, staging, canonical, catalogue };
}

describe('still-image ingestion through the Graphics Asset Library public module', () => {
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
				sourceDigest: sourceDigest(jpegPixel),
			} as const,
			code: 'browser-image-decode-failed',
		},
		{
			label: 'browser evidence mismatch',
			browserDecodeEvidence: {
				outcome: 'decoded',
				sourceDigest: sourceDigest(jpegPixel),
				width: 2,
				height: 1,
			} as const,
			code: 'browser-image-decode-mismatch',
		},
	])('fails publication for $label through the public seam', async ({
		browserDecodeEvidence,
		code,
	}) => {
		const { library } = createLibrary();
		const operation = await library.initiateGraphicsIngestion({
			idempotencyKey: `browser-gate-${code}`,
			initiatedBy: 'graphics-author-1',
			name: 'Browser-gated JPEG',
			sourceFileName: 'browser-gated.jpg',
			declaredMime: 'image/jpeg',
			browserDecodeEvidence,
			declaredByteLength: jpegPixel.byteLength,
		});

		const failed = await library.uploadGraphicAsset({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			declaredMime: 'image/jpeg',
			bytes: createBoundedByteStream(jpegPixel, {
				byteLength: jpegPixel.byteLength,
				maximumByteLength: 25 * 1024 * 1024,
			}),
		});

		expect(failed).toMatchObject({
			stage: 'failed',
			report: {
				outcome: 'rejected',
				issues: [{ code }],
			},
			failure: { code: 'validation-failed', retryable: false },
		});
		await expect(library.listGraphicAssets({})).resolves.toEqual([]);
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
	] as const)('publishes and resolves exact $format source bytes', async ({
		format,
		mime,
		fileName,
		bytes,
	}) => {
		const { library } = createLibrary();
		const operation = await library.initiateGraphicsIngestion({
			idempotencyKey: `upload-${format}`,
			initiatedBy: 'graphics-author-1',
			name: `${format} scoreboard`,
			sourceFileName: fileName,
			declaredMime: mime,
			declaredByteLength: bytes.byteLength,
		});

		const completed = await library.uploadGraphicAsset({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			declaredMime: mime,
			bytes: createBoundedByteStream(bytes, {
				byteLength: bytes.byteLength,
				maximumByteLength: 25 * 1024 * 1024,
			}),
		});

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
		const resolved = await library.resolveGraphicAssetRevision({
			assetId: completed.result!.assetId,
			revisionId: completed.result!.revisionId,
		});
		expect(resolved).toMatchObject({
			outcome: 'available',
			contentType: mime,
			byteLength: bytes.byteLength,
		});
		if (resolved.outcome !== 'available')
			throw new Error('Expected the exact image revision to resolve');
		await expect(consumeBoundedByteStream({
			body: resolved.body,
			byteLength: resolved.byteLength,
			maximumByteLength: resolved.byteLength,
		})).resolves.toEqual(bytes);
	});

	it('rejects conflicting initiation and transfer MIME declarations with a stable report', async () => {
		const { library } = createLibrary();
		const operation = await library.initiateGraphicsIngestion({
			idempotencyKey: 'conflicting-declared-mime',
			initiatedBy: 'graphics-author-1',
			name: 'Conflicting declaration',
			sourceFileName: 'scoreboard.png',
			declaredMime: 'image/jpeg',
			declaredByteLength: transparentPixelPng.byteLength,
		});

		const failed = await library.uploadGraphicAsset({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			declaredMime: 'image/png',
			bytes: createBoundedByteStream(transparentPixelPng, {
				byteLength: transparentPixelPng.byteLength,
				maximumByteLength: 25 * 1024 * 1024,
			}),
		});

		expect(failed).toMatchObject({
			stage: 'failed',
			transferredByteLength: 0,
			report: {
				outcome: 'rejected',
				compatibilityProfile: 'still-image-v1',
				issues: [{ code: 'conflicting-image-mime' }],
			},
			failure: { code: 'validation-failed', retryable: false },
		});
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
	] as const)('reports a stable public validation result for $label', async ({
		bytes,
		fileName,
		mime,
		code,
	}) => {
		const { library } = createLibrary();
		const operation = await library.initiateGraphicsIngestion({
			idempotencyKey: `reject-${code}`,
			initiatedBy: 'graphics-author-1',
			name: fileName,
			sourceFileName: fileName,
			declaredMime: mime,
			declaredByteLength: bytes.byteLength,
		});

		const failed = await library.uploadGraphicAsset({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			declaredMime: mime,
			bytes: createBoundedByteStream(bytes, {
				byteLength: bytes.byteLength,
				maximumByteLength: 25 * 1024 * 1024,
			}),
		});

		expect(failed).toMatchObject({
			stage: 'failed',
			report: {
				outcome: 'rejected',
				compatibilityProfile: 'still-image-v1',
				issues: [{ code }],
			},
			failure: { code: 'validation-failed', retryable: false },
		});
	});

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

	it('durably publishes one validated PNG and discovers it with its exact operation result', async () => {
		const { library } = createLibrary();
		const initiation = {
			idempotencyKey: 'upload-scoreboard-logo',
			initiatedBy: 'graphics-author-1',
			name: 'Scoreboard logo',
			defaultEventId: 7,
			declaredByteLength: transparentPixelPng.byteLength,
		};

		const operation = await library.initiateGraphicsIngestion(initiation);
		const reconnected = await library.initiateGraphicsIngestion(initiation);

		expect(operation).toMatchObject({
			stage: 'created',
			duplicateContentPolicy: 'reuse',
			transferredByteLength: 0,
			declaredByteLength: transparentPixelPng.byteLength,
		});
		expect(reconnected).toEqual(operation);
		await expect(library.listGraphicAssets({ search: '' })).resolves.toEqual([]);

		const completed = await library.uploadGraphicAsset({
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
		const { library } = createLibrary(staging, canonical);
		const operation = await library.initiateGraphicsIngestion({
			idempotencyKey: 'stream-canonical-source',
			initiatedBy: 'graphics-author-1',
			name: 'Streaming source',
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

		expect(completed.stage).toBe('completed');
		expect(canonicalWriteStartedBeforeSourceFinished).toBe(true);
		expect(canonicalSourceFullyRead).toBe(true);
	});

	it('records permanent validation failure without publishing catalogue state', async () => {
		const { library } = createLibrary();
		const invalidPng = new TextEncoder().encode('not a PNG');
		const operation = await library.initiateGraphicsIngestion({
			idempotencyKey: 'invalid-logo',
			initiatedBy: 'graphics-author-1',
			name: 'Invalid logo',
			declaredByteLength: invalidPng.byteLength,
		});

		const failed = await library.uploadGraphicAsset({
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
				issues: [{
					severity: 'error',
					code: 'unsupported-image-format',
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
		const cancelledAgain = await library.cancelGraphicsIngestion({
			operationId: operation.id,
			initiatedBy: 'graphics-author-1',
		});
		const uploadAfterCancellation = await library.uploadGraphicAsset({
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
		const operation = await library.initiateGraphicsIngestion({
			idempotencyKey: 'cancel-during-transfer',
			initiatedBy: 'graphics-author-1',
			name: 'Cancelled during transfer',
			declaredByteLength: transparentPixelPng.byteLength,
		});

		const upload = library.uploadGraphicAsset({
			operationId: operation.id,
			initiatedBy: 'graphics-author-1',
			bytes: createBoundedByteStream(transparentPixelPng, {
				byteLength: transparentPixelPng.byteLength,
				maximumByteLength: 16 * 1024 * 1024,
			}),
		});
		await transferStarted;
		const cancelled = await library.cancelGraphicsIngestion({
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
		const operation = await library.initiateGraphicsIngestion({
			idempotencyKey: 'retry-logo',
			initiatedBy: 'graphics-author-1',
			name: 'Retry logo',
			declaredByteLength: transparentPixelPng.byteLength,
		});
		canonical.injectTransientFailure('create');

		const failed = await library.uploadGraphicAsset({
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

		const completed = await library.retryGraphicsIngestion({
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
			const operation = await library.initiateGraphicsIngestion({
				idempotencyKey,
				initiatedBy: 'graphics-author-1',
				name,
				defaultEventId,
				declaredByteLength: transparentPixelPng.byteLength,
			});
			return await library.uploadGraphicAsset({
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
			const operation = await library.initiateGraphicsIngestion({
				idempotencyKey,
				initiatedBy: 'graphics-author-1',
				name: idempotencyKey,
				duplicateContentPolicy,
				declaredByteLength: transparentPixelPng.byteLength,
			});
			return await library.uploadGraphicAsset({
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

	it('replaces Graphic Asset Content as immutable Graphic Asset Revisions while current Graphic Asset Content is a no-op', async () => {
		const { library } = createLibrary();
		const originalOperation = await library.initiateGraphicsIngestion({
			idempotencyKey: 'replacement-original',
			initiatedBy: 'graphics-author-1',
			name: 'Replaceable logo',
			declaredByteLength: transparentPixelPng.byteLength,
		});
		const original = await library.uploadGraphicAsset({
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
			const operation = await library.initiateGraphicAssetReplacement({
				assetId: original.result!.assetId,
				idempotencyKey,
				initiatedBy: 'graphics-author-1',
				sourceFileName: `replacement.${declaredMime === 'image/png' ? 'png' : 'jpg'}`,
				declaredMime,
				browserDecodeEvidence: {
					outcome: 'decoded',
					sourceDigest: sourceDigest(bytes),
					width: 1,
					height: 1,
				},
				declaredByteLength: bytes.byteLength,
			});
			return await library.uploadGraphicAsset({
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

		await expect(library.listGraphicAssets({})).resolves.toEqual([
			expect.objectContaining({
				id: original.result?.assetId,
				name: 'Replaceable logo',
				revisionId: restored.result?.revisionId,
				revisionNumber: 3,
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

	it('publishes concurrent identical replacement content as one Graphic Asset Revision', async () => {
		const delegate = createInMemoryGraphicsAssetCatalogue();
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
		const { library } = createLibrary(
			createInMemoryStagingGraphicsObjectStore(),
			createInMemoryCanonicalGraphicsObjectStore(),
			catalogue,
		);
		const originalOperation = await library.initiateGraphicsIngestion({
			idempotencyKey: 'concurrent-replacement-original',
			initiatedBy: 'graphics-author-1',
			name: 'Concurrently replaced logo',
			declaredByteLength: transparentPixelPng.byteLength,
		});
		const original = await library.uploadGraphicAsset({
			operationId: originalOperation.id,
			initiatedBy: originalOperation.initiatedBy,
			bytes: createBoundedByteStream(transparentPixelPng, {
				byteLength: transparentPixelPng.byteLength,
				maximumByteLength: 16 * 1024 * 1024,
			}),
		});

		const replacements = await Promise.all(
			['concurrent-replacement-a', 'concurrent-replacement-b'].map(
				async idempotencyKey => await library.initiateGraphicAssetReplacement({
					assetId: original.result!.assetId,
					idempotencyKey,
					initiatedBy: 'graphics-author-1',
					sourceFileName: `${idempotencyKey}.jpg`,
					declaredMime: 'image/jpeg',
					browserDecodeEvidence: {
						outcome: 'decoded',
						sourceDigest: sourceDigest(jpegPixel),
						width: 1,
						height: 1,
					},
					declaredByteLength: jpegPixel.byteLength,
				}),
			),
		);
		const completed = await Promise.all(replacements.map(
			async operation => await library.uploadGraphicAsset({
				operationId: operation.id,
				initiatedBy: operation.initiatedBy,
				declaredMime: 'image/jpeg',
				bytes: createBoundedByteStream(jpegPixel, {
					byteLength: jpegPixel.byteLength,
					maximumByteLength: 16 * 1024 * 1024,
				}),
			}),
		));

		expect(completed.map(operation => operation.result?.outcome).sort()).toEqual([
			'replacement-noop',
			'revision-created',
		]);
		expect(new Set(completed.map(operation => operation.result?.revisionId)).size).toBe(1);
		await expect(library.listGraphicAssets({})).resolves.toEqual([
			expect.objectContaining({
				id: original.result?.assetId,
				revisionId: completed[0]!.result?.revisionId,
				revisionNumber: 2,
			}),
		]);
	});

	it('rejects a stale replacement no-op and creates a Graphic Asset Revision when retried', async () => {
		const delegate = createInMemoryGraphicsAssetCatalogue();
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
		const { library } = createLibrary(
			createInMemoryStagingGraphicsObjectStore(),
			createInMemoryCanonicalGraphicsObjectStore(),
			catalogue,
		);
		const originalOperation = await library.initiateGraphicsIngestion({
			idempotencyKey: 'stale-noop-original',
			initiatedBy: 'graphics-author-1',
			name: 'Stale no-op logo',
			declaredByteLength: transparentPixelPng.byteLength,
		});
		const original = await library.uploadGraphicAsset({
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
			return await library.initiateGraphicAssetReplacement({
				assetId: original.result!.assetId,
				idempotencyKey,
				initiatedBy: 'graphics-author-1',
				sourceFileName: `${idempotencyKey}.${declaredMime === 'image/png' ? 'png' : 'jpg'}`,
				declaredMime,
				browserDecodeEvidence: {
					outcome: 'decoded',
					sourceDigest: sourceDigest(bytes),
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
		const staleCompletion = library.uploadGraphicAsset({
			operationId: staleNoop.id,
			initiatedBy: staleNoop.initiatedBy,
			declaredMime: 'image/png',
			bytes: createBoundedByteStream(transparentPixelPng, {
				byteLength: transparentPixelPng.byteLength,
				maximumByteLength: 16 * 1024 * 1024,
			}),
		});
		await noopStarted;

		const changed = await replacementOperation(
			'stale-noop-intervening-content',
			jpegPixel,
			'image/jpeg',
		);
		const changedCompletion = await library.uploadGraphicAsset({
			operationId: changed.id,
			initiatedBy: changed.initiatedBy,
			declaredMime: 'image/jpeg',
			bytes: createBoundedByteStream(jpegPixel, {
				byteLength: jpegPixel.byteLength,
				maximumByteLength: 16 * 1024 * 1024,
			}),
		});
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

		const retried = await library.retryGraphicsIngestion({
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
		await expect(library.listGraphicAssets({})).resolves.toEqual([
			expect.objectContaining({
				revisionId: retried.result?.revisionId,
				revisionNumber: 3,
			}),
		]);
	});

	it('updates Graphic Asset metadata and Event associations without creating a Graphic Asset Revision', async () => {
		const { library } = createLibrary();
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
		const operation = await library.initiateGraphicsIngestion({
			idempotencyKey: 'corrupt-canonical-logo',
			initiatedBy: 'graphics-author-1',
			name: 'Corrupt canonical logo',
			declaredByteLength: transparentPixelPng.byteLength,
		});

		const failed = await library.uploadGraphicAsset({
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
			async findReusableGraphicAsset(sourceDigest: string) {
				reusableLookups++;
				if (reusableLookups === 2)
					releaseLookups();
				await bothLooking;
				return await delegate.findReusableGraphicAsset(sourceDigest);
			},
		};
		const { library } = createLibrary(
			createInMemoryStagingGraphicsObjectStore(),
			createInMemoryCanonicalGraphicsObjectStore(),
			catalogue,
		);
		const operations = await Promise.all([
			library.initiateGraphicsIngestion({
				idempotencyKey: 'concurrent-a',
				initiatedBy: 'graphics-author-1',
				name: 'Concurrent A',
				declaredByteLength: transparentPixelPng.byteLength,
			}),
			library.initiateGraphicsIngestion({
				idempotencyKey: 'concurrent-b',
				initiatedBy: 'graphics-author-1',
				name: 'Concurrent B',
				declaredByteLength: transparentPixelPng.byteLength,
			}),
		]);
		const completed = await Promise.all(operations.map(operation => library.uploadGraphicAsset({
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
			async publishGraphicAsset(input: Parameters<typeof delegate.publishGraphicAsset>[0]) {
				publicationStarted();
				await released;
				return await delegate.publishGraphicAsset(input);
			},
		};
		const { library } = createLibrary(
			createInMemoryStagingGraphicsObjectStore(),
			createInMemoryCanonicalGraphicsObjectStore(),
			catalogue,
		);
		const operation = await library.initiateGraphicsIngestion({
			idempotencyKey: 'cancel-before-publication',
			initiatedBy: 'graphics-author-1',
			name: 'Cancelled before publication',
			declaredByteLength: transparentPixelPng.byteLength,
		});
		const upload = library.uploadGraphicAsset({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			bytes: createBoundedByteStream(transparentPixelPng, {
				byteLength: transparentPixelPng.byteLength,
				maximumByteLength: 16 * 1024 * 1024,
			}),
		});
		await started;
		const cancelled = await library.cancelGraphicsIngestion({
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
		const created = await library.initiateGraphicsIngestion({
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
		}, transferring.updatedAt)).rejects.toThrow('lost its claim');
	});
});

describe('silent-video ingestion through the Graphics Asset Library public module', () => {
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
			posterDigest: sourceDigest(sixteenPixelPosterPng),
			poster: createBoundedByteStream(sixteenPixelPosterPng, {
				byteLength: sixteenPixelPosterPng.byteLength,
				maximumByteLength: MAX_SILENT_VIDEO_POSTER_BYTES,
			}),
		}));
		const { library } = createLibrary(
			undefined,
			undefined,
			undefined,
			undefined,
			{ validate },
		);
		const initiated = await library.initiateGraphicsIngestion({
			idempotencyKey: 'trusted-video-runtime',
			initiatedBy: 'graphics-author-1',
			name: 'Trusted VP9',
			sourceFileName: 'trusted.webm',
			declaredMime: 'video/webm',
			declaredByteLength: vp9Webm.byteLength,
		});

		const completed = await library.uploadGraphicAsset({
			operationId: initiated.id,
			initiatedBy: initiated.initiatedBy,
			declaredMime: 'video/webm',
			bytes: createBoundedByteStream(vp9Webm, {
				byteLength: vp9Webm.byteLength,
				maximumByteLength: 250 * 1024 * 1024,
			}),
		});

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
			sourceDigest: sourceDigest(vp9Webm),
			inspectedFacts: expect.objectContaining({
				sha256: sourceDigest(vp9Webm),
				format: 'webm',
				codec: 'vp9',
			}),
			factsDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
			idempotencyKey: expect.stringContaining(initiated.id),
		}));
	});

	it('fails retryably closed when the trusted playback runtime is unavailable', async () => {
		const { library } = createLibrary();
		const initiated = await library.initiateGraphicsIngestion({
			idempotencyKey: 'missing-video-runtime',
			initiatedBy: 'graphics-author-1',
			name: 'No runtime VP9',
			sourceFileName: 'missing-runtime.webm',
			declaredMime: 'video/webm',
			declaredByteLength: vp9Webm.byteLength,
		});

		const failed = await library.uploadGraphicAsset({
			operationId: initiated.id,
			initiatedBy: initiated.initiatedBy,
			declaredMime: 'video/webm',
			bytes: createBoundedByteStream(vp9Webm, {
				byteLength: vp9Webm.byteLength,
				maximumByteLength: 250 * 1024 * 1024,
			}),
		});

		expect(failed).toMatchObject({
			stage: 'failed',
			failure: {
				code: 'validation-runtime-unavailable',
				retryable: true,
			},
		});
		await expect(library.listGraphicAssets({})).resolves.toEqual([]);
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
			posterDigest: sourceDigest(sixteenPixelPosterPng),
			poster: createBoundedByteStream(sixteenPixelPosterPng, {
				byteLength: sixteenPixelPosterPng.byteLength,
				maximumByteLength: MAX_SILENT_VIDEO_POSTER_BYTES,
			}),
		});
		const validate = vi.fn()
			.mockResolvedValueOnce({ outcome: 'unavailable', retryable: true })
			.mockImplementation(async input => accepted(input));
		const { library } = createLibrary(
			undefined,
			undefined,
			undefined,
			undefined,
			{ validate },
		);
		const initiated = await library.initiateGraphicsIngestion({
			idempotencyKey: 'trusted-video-retry',
			initiatedBy: 'graphics-author-1',
			name: 'Retry trusted VP9',
			sourceFileName: 'retry.webm',
			declaredMime: 'video/webm',
			declaredByteLength: vp9Webm.byteLength,
		});
		const first = await library.uploadGraphicAsset({
			operationId: initiated.id,
			initiatedBy: initiated.initiatedBy,
			declaredMime: 'video/webm',
			bytes: createBoundedByteStream(vp9Webm, {
				byteLength: vp9Webm.byteLength,
				maximumByteLength: 250 * 1024 * 1024,
			}),
		});
		expect(first).toMatchObject({
			stage: 'failed',
			failure: { code: 'validation-runtime-unavailable', retryable: true },
		});

		const completed = await library.retryGraphicsIngestion({
			operationId: initiated.id,
			initiatedBy: initiated.initiatedBy,
		});
		expect(completed.stage).toBe('completed');
		expect(validate).toHaveBeenCalledTimes(2);
		expect(validate.mock.calls[1]![0]).toMatchObject({
			operationId: validate.mock.calls[0]![0].operationId,
			idempotencyKey: validate.mock.calls[0]![0].idempotencyKey,
			sourceDigest: validate.mock.calls[0]![0].sourceDigest,
			factsDigest: validate.mock.calls[0]![0].factsDigest,
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
			posterDigest: sourceDigest(sixteenPixelPosterPng),
			poster: createBoundedByteStream(sixteenPixelPosterPng, {
				byteLength: sixteenPixelPosterPng.byteLength,
				maximumByteLength: MAX_SILENT_VIDEO_POSTER_BYTES,
			}),
		}));
		const { library } = createLibrary(
			undefined,
			undefined,
			undefined,
			undefined,
			{ validate },
		);
		const initiated = await library.initiateGraphicsIngestion({
			idempotencyKey: 'misbound-trusted-video',
			initiatedBy: 'graphics-author-1',
			name: 'Misbound trusted VP9',
			sourceFileName: 'misbound.webm',
			declaredMime: 'video/webm',
			declaredByteLength: vp9Webm.byteLength,
		});
		const failed = await library.uploadGraphicAsset({
			operationId: initiated.id,
			initiatedBy: initiated.initiatedBy,
			declaredMime: 'video/webm',
			bytes: createBoundedByteStream(vp9Webm, {
				byteLength: vp9Webm.byteLength,
				maximumByteLength: 250 * 1024 * 1024,
			}),
		});
		expect(failed).toMatchObject({
			stage: 'failed',
			failure: { code: 'validation-runtime-unavailable', retryable: true },
		});
	});

	it('maps a trusted adapter execution fault to retryable runtime unavailability', async () => {
		const { library } = createLibrary(
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
		const initiated = await library.initiateGraphicsIngestion({
			idempotencyKey: 'faulting-trusted-video',
			initiatedBy: 'graphics-author-1',
			name: 'Faulting trusted VP9',
			sourceFileName: 'fault.webm',
			declaredMime: 'video/webm',
			declaredByteLength: vp9Webm.byteLength,
		});
		const failed = await library.uploadGraphicAsset({
			operationId: initiated.id,
			initiatedBy: initiated.initiatedBy,
			declaredMime: 'video/webm',
			bytes: createBoundedByteStream(vp9Webm, {
				byteLength: vp9Webm.byteLength,
				maximumByteLength: 250 * 1024 * 1024,
			}),
		});

		expect(failed).toMatchObject({
			stage: 'failed',
			failure: { code: 'validation-runtime-unavailable', retryable: true },
		});
	});

	it('fails retryably closed when the trusted runtime returns an invalid poster', async () => {
		const invalidPoster = Uint8Array.of(1, 2, 3);
		const { library } = createLibrary(
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
						posterDigest: sourceDigest(invalidPoster),
						poster: createBoundedByteStream(invalidPoster, {
							byteLength: invalidPoster.byteLength,
							maximumByteLength: MAX_SILENT_VIDEO_POSTER_BYTES,
						}),
					};
				},
			},
		);
		const initiated = await library.initiateGraphicsIngestion({
			idempotencyKey: 'invalid-trusted-poster',
			initiatedBy: 'graphics-author-1',
			name: 'Invalid trusted poster',
			sourceFileName: 'invalid-poster.webm',
			declaredMime: 'video/webm',
			declaredByteLength: vp9Webm.byteLength,
		});
		const failed = await library.uploadGraphicAsset({
			operationId: initiated.id,
			initiatedBy: initiated.initiatedBy,
			declaredMime: 'video/webm',
			bytes: createBoundedByteStream(vp9Webm, {
				byteLength: vp9Webm.byteLength,
				maximumByteLength: 250 * 1024 * 1024,
			}),
		});

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
		const { library } = createLibrary(
			undefined,
			undefined,
			undefined,
			undefined,
			{ validate },
		);
		const initiated = await library.initiateGraphicsIngestion({
			idempotencyKey: 'trusted-video-rejected',
			initiatedBy: 'graphics-author-1',
			name: 'Rejected trusted VP9',
			sourceFileName: 'rejected.webm',
			declaredMime: 'video/webm',
			declaredByteLength: vp9Webm.byteLength,
		});
		const failed = await library.uploadGraphicAsset({
			operationId: initiated.id,
			initiatedBy: initiated.initiatedBy,
			declaredMime: 'video/webm',
			bytes: createBoundedByteStream(vp9Webm, {
				byteLength: vp9Webm.byteLength,
				maximumByteLength: 250 * 1024 * 1024,
			}),
		});
		expect(failed).toMatchObject({
			stage: 'failed',
			report: {
				outcome: 'rejected',
				issues: [{ code: 'browser-video-playback-failed' }],
			},
			failure: { code: 'validation-failed', retryable: false },
		});
	});

	it('reserves the poster envelope in the Graphics Staging Allowance', async () => {
		const blockedCatalogue = createInMemoryGraphicsAssetCatalogue({
			stagingLimitBytes: vp9Webm.byteLength + MAX_SILENT_VIDEO_POSTER_BYTES - 1,
		});
		const { library: blocked } = createLibrary(
			createInMemoryStagingGraphicsObjectStore(),
			createInMemoryCanonicalGraphicsObjectStore(),
			blockedCatalogue,
		);
		await expect(blocked.initiateGraphicsIngestion({
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

		const { library } = createLibrary();
		const initiated = await library.initiateGraphicsIngestion({
			idempotencyKey: 'vp9-poster-capacity-accounted',
			initiatedBy: 'graphics-author-1',
			name: 'VP9 poster accounted',
			sourceFileName: 'ident.webm',
			declaredMime: 'video/webm',
			declaredByteLength: vp9Webm.byteLength,
		});
		await expect(library.getCapacity()).resolves.toMatchObject({
			staging: {
				usedBytes: 0,
				reservedBytes: vp9Webm.byteLength + MAX_SILENT_VIDEO_POSTER_BYTES,
			},
		});
		await library.uploadGraphicAsset({
			operationId: initiated.id,
			initiatedBy: initiated.initiatedBy,
			declaredMime: 'video/webm',
			bytes: createBoundedByteStream(vp9Webm, {
				byteLength: vp9Webm.byteLength,
				maximumByteLength: 250 * 1024 * 1024,
			}),
		});
		await expect(library.getCapacity()).resolves.toMatchObject({
			staging: {
				usedBytes: vp9Webm.byteLength,
				reservedBytes: MAX_SILENT_VIDEO_POSTER_BYTES,
			},
		});
	});
});
