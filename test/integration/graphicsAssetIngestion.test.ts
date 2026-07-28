import type {
	GraphicAsset,
	GraphicsIngestionOperation,
} from '~~/shared/types/graphicsAsset';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { $fetch, fetch } from '@nuxt/test-utils/e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GRAPHICS_MULTIPART_PART_BYTES } from '../../shared/utils/graphicsAssetCompatibility';
import { createGraphicsAuthorSessionCookie } from './graphicsAuthorSession';

const authorHeaders: Record<string, string> = {
	'x-graphics-author-id': 'integration-graphics-author',
};
const transparentPixelPng = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
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

function browserDecodeEvidence(bytes: Uint8Array) {
	return {
		outcome: 'decoded' as const,
		sourceDigest: createHash('sha256').update(bytes).digest('hex'),
		width: 1,
		height: 1,
	};
}

function rejectedBrowserDecodeEvidence(bytes: Uint8Array) {
	return {
		outcome: 'rejected' as const,
		sourceDigest: createHash('sha256').update(bytes).digest('hex'),
	};
}

function jpegSegment(marker: number, payload: Uint8Array) {
	const length = payload.byteLength + 2;
	return Uint8Array.of(0xFF, marker, length >>> 8, length & 0xFF, ...payload);
}

function insertAfterJpegSignature(bytes: Uint8Array, segment: Uint8Array) {
	return Uint8Array.of(...bytes.subarray(0, 2), ...segment, ...bytes.subarray(2));
}

function jpegFrameDataOffset(bytes: Uint8Array) {
	for (let index = 0; index < bytes.byteLength - 1; index++) {
		if (bytes[index] === 0xFF && (bytes[index + 1] === 0xC0 || bytes[index + 1] === 0xC2))
			return index + 4;
	}
	throw new Error('JPEG fixture does not contain a supported frame marker');
}

function jpegWithFrameFacts(width: number, height: number, precision = 8) {
	const bytes = Uint8Array.from(jpegPixel);
	const offset = jpegFrameDataOffset(bytes);
	bytes[offset] = precision;
	bytes[offset + 1] = height >>> 8;
	bytes[offset + 2] = height & 0xFF;
	bytes[offset + 3] = width >>> 8;
	bytes[offset + 4] = width & 0xFF;
	return bytes;
}

function jpegWithOrientationSix() {
	const exif = Uint8Array.of(
		0x45,
		0x78,
		0x69,
		0x66,
		0,
		0,
		0x49,
		0x49,
		0x2A,
		0,
		8,
		0,
		0,
		0,
		1,
		0,
		0x12,
		0x01,
		3,
		0,
		1,
		0,
		0,
		0,
		6,
		0,
		0,
		0,
		0,
		0,
		0,
		0,
	);
	return insertAfterJpegSignature(jpegPixel, jpegSegment(0xE1, exif));
}

function jpegWithColourProfile() {
	return insertAfterJpegSignature(
		jpegPixel,
		jpegSegment(0xE2, new TextEncoder().encode('ICC_PROFILE\0')),
	);
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

describe('the bounded still-image ingestion and Library Workspace APIs', () => {
	let eventId: number;

	beforeAll(async () => {
		authorHeaders.cookie = await createGraphicsAuthorSessionCookie();
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: {
				name: 'Graphics Asset Integration Event',
				game: 'mtg',
				featureMatchOrientation: 'horizontal',
			},
		});
		eventId = event.id;
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	it('reconnects to a durable operation, streams source bytes, and discovers the atomic result', async () => {
		const initiationBody = {
			idempotencyKey: 'integration-scoreboard-logo',
			name: 'Integration scoreboard logo',
			defaultEventId: eventId,
			browserDecodeEvidence: browserDecodeEvidence(transparentPixelPng),
			declaredByteLength: transparentPixelPng.byteLength,
		};
		const initiated = await $fetch<GraphicsIngestionOperation>('/api/graphics-assets/ingestion-operations', {
			method: 'POST',
			headers: authorHeaders,
			body: initiationBody,
		});
		const reconnected = await $fetch<GraphicsIngestionOperation>('/api/graphics-assets/ingestion-operations', {
			method: 'POST',
			headers: authorHeaders,
			body: initiationBody,
		});
		expect(reconnected).toEqual(initiated);

		const undiscoverable = await $fetch<GraphicAsset[]>('/api/graphics-assets', {
			query: { search: 'integration scoreboard' },
		});
		expect(undiscoverable).toEqual([]);

		const uploadResponse = await fetch(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/content`,
			{
				method: 'PUT',
				headers: {
					...authorHeaders,
					'content-type': 'image/png',
				},
				body: transparentPixelPng,
			},
		);
		expect(uploadResponse.status).toBe(200);
		const completed = await uploadResponse.json() as GraphicsIngestionOperation;
		expect(completed).toMatchObject({
			stage: 'completed',
			report: {
				outcome: 'accepted',
				facts: {
					canonicalMime: 'image/png',
					sha256: '431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460',
					width: 1,
					height: 1,
					browserDecodable: true,
				},
			},
			result: { outcome: 'published' },
		});

		const operation = await $fetch<GraphicsIngestionOperation>(
			`/api/graphics-assets/ingestion-operations/${initiated.id}`,
			{ headers: authorHeaders },
		);
		expect(operation).toEqual(completed);

		const assets = await $fetch<GraphicAsset[]>('/api/graphics-assets', {
			query: { search: 'scoreboard' },
		});
		expect(assets).toEqual([
			expect.objectContaining({
				name: 'Integration scoreboard logo',
				eventIds: [eventId],
				operation: completed,
			}),
		]);

		const thumbnail = await fetch(`/api/graphics-assets/${completed.result!.assetId}/thumbnail`);
		expect(thumbnail.status).toBe(200);
		expect(thumbnail.headers.get('content-type')).toBe('image/png');
		expect(Array.from(new Uint8Array(await thumbnail.arrayBuffer()).slice(0, 8)))
			.toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

		const pinnedContent = await fetch(
			`/api/graphics-assets/${completed.result!.assetId}/revisions/${completed.result!.revisionId}/content`,
			{ headers: authorHeaders },
		);
		expect(pinnedContent.status).toBe(200);
		expect(pinnedContent.headers.get('content-type')).toBe('image/png');
		expect(pinnedContent.headers.get('cache-control')).toBe('private, no-store');
		expect(new Uint8Array(await pinnedContent.arrayBuffer())).toEqual(transparentPixelPng);

		const anonymousContent = await fetch(
			`/api/graphics-assets/${completed.result!.assetId}/revisions/${completed.result!.revisionId}/content`,
		);
		expect(anonymousContent.status).toBe(401);

		const missingRevision = await fetch(
			`/api/graphics-assets/${completed.result!.assetId}/revisions/missing-revision/content`,
			{ headers: authorHeaders },
		);
		expect(missingRevision.status).toBe(404);

		const duplicate = await $fetch<GraphicsIngestionOperation>('/api/graphics-assets/ingestion-operations', {
			method: 'POST',
			headers: authorHeaders,
			body: {
				idempotencyKey: 'integration-duplicate-scoreboard-logo',
				name: 'Duplicate upload name',
				defaultEventId: eventId,
				browserDecodeEvidence: browserDecodeEvidence(transparentPixelPng),
				declaredByteLength: transparentPixelPng.byteLength,
			},
		});
		const duplicateResponse = await fetch(
			`/api/graphics-assets/ingestion-operations/${duplicate.id}/content`,
			{ method: 'PUT', headers: authorHeaders, body: transparentPixelPng },
		);
		const reused = await duplicateResponse.json() as GraphicsIngestionOperation;
		expect(reused.result).toEqual({
			outcome: 'reused',
			assetId: completed.result!.assetId,
			revisionId: completed.result!.revisionId,
		});
		await expect($fetch<GraphicAsset[]>('/api/graphics-assets', {
			query: { search: 'scoreboard' },
		})).resolves.toEqual([
			expect.objectContaining({
				name: 'Integration scoreboard logo',
				eventIds: [eventId],
				operation: reused,
			}),
		]);

		const separate = await $fetch<GraphicsIngestionOperation>('/api/graphics-assets/ingestion-operations', {
			method: 'POST',
			headers: authorHeaders,
			body: {
				idempotencyKey: 'integration-separate-scoreboard-logo',
				name: 'Separate scoreboard logo',
				duplicateContentPolicy: 'create-separate',
				browserDecodeEvidence: browserDecodeEvidence(transparentPixelPng),
				declaredByteLength: transparentPixelPng.byteLength,
			},
		});
		const separateResponse = await fetch(
			`/api/graphics-assets/ingestion-operations/${separate.id}/content`,
			{ method: 'PUT', headers: authorHeaders, body: transparentPixelPng },
		);
		const separatelyPublished = await separateResponse.json() as GraphicsIngestionOperation;
		expect(separatelyPublished.result).toMatchObject({ outcome: 'published' });
		expect(separatelyPublished.result?.assetId).not.toBe(completed.result?.assetId);
		await expect($fetch<GraphicAsset[]>('/api/graphics-assets', {
			query: { search: 'scoreboard' },
		})).resolves.toHaveLength(2);
	});

	it('resumes a multipart transfer from server-verified parts and tolerates an ambiguous duplicate request', async () => {
		const bytes = new Uint8Array(GRAPHICS_MULTIPART_PART_BYTES + 1);
		const initiated = await $fetch<GraphicsIngestionOperation>('/api/graphics-assets/ingestion-operations', {
			method: 'POST',
			headers: authorHeaders,
			body: {
				idempotencyKey: 'integration-resumable-large-image',
				name: 'Interrupted large image',
				declaredMime: 'image/png',
				browserDecodeEvidence: rejectedBrowserDecodeEvidence(bytes),
				declaredByteLength: bytes.byteLength,
			},
		});

		const started = await $fetch<GraphicsIngestionOperation>(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/multipart`,
			{ method: 'POST', headers: authorHeaders },
		);
		expect(started).toMatchObject({
			stage: 'transferring',
			transferredByteLength: 0,
			transfer: {
				partByteLength: GRAPHICS_MULTIPART_PART_BYTES,
				maximumConcurrentParts: 3,
				maximumPartAttempts: 3,
				partCount: 2,
				completedParts: [],
			},
		});

		const firstPart = bytes.subarray(0, GRAPHICS_MULTIPART_PART_BYTES);
		const firstResponse = await fetch(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/multipart/parts/1`,
			{ method: 'PUT', headers: authorHeaders, body: firstPart },
		);
		expect(firstResponse.status).toBe(200);
		const afterFirst = await firstResponse.json() as GraphicsIngestionOperation;
		expect(afterFirst).toMatchObject({
			transferredByteLength: GRAPHICS_MULTIPART_PART_BYTES,
			transfer: {
				completedParts: [{
					partNumber: 1,
					partIdentity: `${initiated.id}:1`,
					byteLength: GRAPHICS_MULTIPART_PART_BYTES,
				}],
			},
		});

		const reconnected = await $fetch<GraphicsIngestionOperation>(
			`/api/graphics-assets/ingestion-operations/${initiated.id}`,
			{ headers: authorHeaders },
		);
		expect(reconnected).toEqual(afterFirst);

		const duplicateResponse = await fetch(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/multipart/parts/1`,
			{ method: 'PUT', headers: authorHeaders, body: firstPart },
		);
		expect(duplicateResponse.status).toBe(200);
		await expect(duplicateResponse.json()).resolves.toEqual(afterFirst);

		const finalResponse = await fetch(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/multipart/parts/2`,
			{ method: 'PUT', headers: authorHeaders, body: bytes.subarray(GRAPHICS_MULTIPART_PART_BYTES) },
		);
		expect(finalResponse.status).toBe(200);
		const ready = await finalResponse.json() as GraphicsIngestionOperation;
		expect(ready.transferredByteLength).toBe(bytes.byteLength);

		const completionResponse = await fetch(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/multipart/complete`,
			{ method: 'POST', headers: authorHeaders },
		);
		expect(completionResponse.status).toBe(200);
		expect(await completionResponse.json()).toMatchObject({
			stage: 'failed',
			transferredByteLength: bytes.byteLength,
			report: {
				outcome: 'rejected',
				issues: [{ code: 'unsupported-image-format' }],
			},
			failure: { code: 'validation-failed', retryable: false },
		});
	});

	it('exposes cancellation and permanent validation failure as structured operations', async () => {
		const cancelled = await $fetch<GraphicsIngestionOperation>('/api/graphics-assets/ingestion-operations', {
			method: 'POST',
			headers: authorHeaders,
			body: {
				idempotencyKey: 'integration-cancelled-logo',
				name: 'Cancelled integration logo',
				declaredByteLength: transparentPixelPng.byteLength,
			},
		});
		const cancellation = await $fetch<GraphicsIngestionOperation>(
			`/api/graphics-assets/ingestion-operations/${cancelled.id}`,
			{ method: 'DELETE', headers: authorHeaders },
		);
		expect(cancellation).toMatchObject({
			stage: 'cancelled',
			failure: { code: 'ingestion-cancelled', retryable: false },
		});

		const invalidBytes = new TextEncoder().encode('not an image');
		const invalid = await $fetch<GraphicsIngestionOperation>('/api/graphics-assets/ingestion-operations', {
			method: 'POST',
			headers: authorHeaders,
			body: {
				idempotencyKey: 'integration-invalid-logo',
				name: 'Invalid integration logo',
				browserDecodeEvidence: rejectedBrowserDecodeEvidence(invalidBytes),
				declaredByteLength: invalidBytes.byteLength,
			},
		});
		const response = await fetch(
			`/api/graphics-assets/ingestion-operations/${invalid.id}/content`,
			{ method: 'PUT', headers: authorHeaders, body: invalidBytes },
		);
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			stage: 'failed',
			report: {
				outcome: 'rejected',
				compatibilityProfile: 'still-image-v1',
				issues: [{ code: 'unsupported-image-format' }],
			},
			failure: { code: 'validation-failed', retryable: false },
		});
	});

	it('rejects a declared image transfer above 25 MiB before route code consumes it', async () => {
		const response = await fetch('/api/graphics-assets/ingestion-operations/not-created/content', {
			method: 'PUT',
			headers: authorHeaders,
			body: new Uint8Array(25 * 1024 * 1024 + 1),
		});

		expect(response.status).toBe(413);
	});

	it('records a stable validation issue when declared MIME conflicts with the signature', async () => {
		const operation = await $fetch<GraphicsIngestionOperation>('/api/graphics-assets/ingestion-operations', {
			method: 'POST',
			headers: authorHeaders,
			body: {
				idempotencyKey: 'integration-conflicting-png-mime',
				name: 'Conflicting MIME',
				browserDecodeEvidence: browserDecodeEvidence(transparentPixelPng),
				declaredByteLength: transparentPixelPng.byteLength,
			},
		});
		const response = await fetch(
			`/api/graphics-assets/ingestion-operations/${operation.id}/content`,
			{
				method: 'PUT',
				headers: { ...authorHeaders, 'content-type': 'image/jpeg' },
				body: transparentPixelPng,
			},
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			stage: 'failed',
			report: {
				outcome: 'rejected',
				issues: [{ code: 'conflicting-image-mime' }],
			},
			failure: { code: 'validation-failed', retryable: false },
		});
	});

	it('records a stable report for a conflicting MIME outside the accepted allowlist', async () => {
		const operation = await $fetch<GraphicsIngestionOperation>('/api/graphics-assets/ingestion-operations', {
			method: 'POST',
			headers: authorHeaders,
			body: {
				idempotencyKey: 'integration-conflicting-unsupported-mime',
				name: 'Unsupported MIME declaration',
				sourceFileName: 'declared.png',
				declaredMime: 'image/gif',
				browserDecodeEvidence: browserDecodeEvidence(transparentPixelPng),
				declaredByteLength: transparentPixelPng.byteLength,
			},
		});
		const response = await fetch(
			`/api/graphics-assets/ingestion-operations/${operation.id}/content`,
			{
				method: 'PUT',
				headers: { ...authorHeaders, 'content-type': 'image/gif' },
				body: transparentPixelPng,
			},
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			stage: 'failed',
			report: {
				outcome: 'rejected',
				issues: [{ code: 'conflicting-image-mime' }],
			},
			failure: { code: 'validation-failed', retryable: false },
		});
	});

	it.each([
		{
			label: 'JPEG orientation',
			bytes: jpegWithOrientationSix(),
			fileName: 'rotated.jpg',
			mime: 'image/jpeg',
			code: 'unsupported-image-orientation',
		},
		{
			label: 'JPEG colour profile',
			bytes: jpegWithColourProfile(),
			fileName: 'profiled.jpg',
			mime: 'image/jpeg',
			code: 'unsupported-jpeg-profile',
		},
		{
			label: 'JPEG bit depth',
			bytes: jpegWithFrameFacts(1, 1, 12),
			fileName: 'twelve-bit.jpg',
			mime: 'image/jpeg',
			code: 'unsupported-jpeg-colour',
		},
		{
			label: 'JPEG axis limit',
			bytes: jpegWithFrameFacts(8193, 1),
			fileName: 'wide.jpg',
			mime: 'image/jpeg',
			code: 'image-dimensions-exceeded',
		},
		{
			label: 'JPEG pixel limit',
			bytes: jpegWithFrameFacts(4097, 4097),
			fileName: 'too-many-pixels.jpg',
			mime: 'image/jpeg',
			code: 'image-pixels-exceeded',
		},
		{
			label: 'partial JPEG',
			bytes: jpegPixel.subarray(0, -1),
			fileName: 'partial.jpg',
			mime: 'image/jpeg',
			code: 'incomplete-jpeg-frame',
		},
		{
			label: 'WebP animation',
			bytes: animatedWebp(),
			fileName: 'animated.webp',
			mime: 'image/webp',
			code: 'unsupported-webp-animation',
		},
	])('rejects $label through the durable public ingestion seam', async ({
		label,
		bytes,
		fileName,
		mime,
		code,
	}) => {
		const initiated = await $fetch<GraphicsIngestionOperation>('/api/graphics-assets/ingestion-operations', {
			method: 'POST',
			headers: authorHeaders,
			body: {
				idempotencyKey: `integration-profile-rejection-${label}`,
				name: `Rejected ${label}`,
				sourceFileName: fileName,
				declaredMime: mime,
				browserDecodeEvidence: rejectedBrowserDecodeEvidence(bytes),
				declaredByteLength: bytes.byteLength,
			},
		});
		const response = await fetch(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/content`,
			{
				method: 'PUT',
				headers: { ...authorHeaders, 'content-type': mime },
				body: bytes,
			},
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			stage: 'failed',
			report: {
				outcome: 'rejected',
				issues: [{ code }],
			},
			failure: { code: 'validation-failed', retryable: false },
		});
		await expect($fetch<GraphicAsset[]>('/api/graphics-assets', {
			query: { search: `Rejected ${label}` },
		})).resolves.toEqual([]);
	});

	it.each([
		{
			label: 'JPEG',
			bytes: jpegPixel,
			fileName: 'integration-photo.jpg',
			mime: 'image/jpeg',
			format: 'jpeg',
		},
		{
			label: 'WebP',
			bytes: webpPixel,
			fileName: 'integration-photo.webp',
			mime: 'image/webp',
			format: 'webp',
		},
	])('publishes exact $label source bytes with verified facts and a PNG thumbnail', async ({
		label,
		bytes,
		fileName,
		mime,
		format,
	}) => {
		const initiated = await $fetch<GraphicsIngestionOperation>('/api/graphics-assets/ingestion-operations', {
			method: 'POST',
			headers: authorHeaders,
			body: {
				idempotencyKey: `integration-${format}-image`,
				name: `Integration ${label} image`,
				sourceFileName: fileName,
				declaredMime: mime,
				browserDecodeEvidence: browserDecodeEvidence(bytes),
				declaredByteLength: bytes.byteLength,
			},
		});
		const response = await fetch(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/content`,
			{
				method: 'PUT',
				headers: { ...authorHeaders, 'content-type': mime },
				body: bytes,
			},
		);

		expect(response.status).toBe(200);
		const completed = await response.json() as GraphicsIngestionOperation;
		expect(completed).toMatchObject({
			stage: 'completed',
			sourceFileName: fileName,
			declaredMime: mime,
			report: {
				outcome: 'accepted',
				compatibilityProfile: 'still-image-v1',
				facts: {
					format,
					canonicalMime: mime,
					width: 1,
					height: 1,
					frameCount: 1,
					bitDepth: 8,
					colorSpace: 'srgb',
					orientation: 'normal',
					browserDecodable: true,
				},
			},
		});

		const pinnedContent = await fetch(
			`/api/graphics-assets/${completed.result!.assetId}/revisions/${completed.result!.revisionId}/content`,
			{ headers: authorHeaders },
		);
		expect(pinnedContent.status).toBe(200);
		expect(pinnedContent.headers.get('content-type')).toBe(mime);
		expect(new Uint8Array(await pinnedContent.arrayBuffer())).toEqual(bytes);

		const thumbnail = await fetch(`/api/graphics-assets/${completed.result!.assetId}/thumbnail`);
		expect(thumbnail.status).toBe(200);
		expect(thumbnail.headers.get('content-type')).toBe('image/png');
		expect(Array.from(new Uint8Array(await thumbnail.arrayBuffer()).slice(0, 8)))
			.toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
	});
});
