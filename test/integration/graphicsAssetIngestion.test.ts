import type {
	GraphicAsset,
	GraphicsIngestionOperation,
} from '~~/shared/types/graphicsAsset';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GRAPHICS_MULTIPART_PART_BYTES } from '../../shared/utils/graphicsAssetCompatibility';
import { $fetch, fetch, operatorSessionCookie } from './client';
import { graphicsIngestionRequest } from './graphicsIngestionRequest';
import { expectResponseStatus } from './responseStatus';

/** Filled with the graphics author session cookie, the only author identity. */
const authorHeaders: Record<string, string> = {};
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

describe('the bounded still-image ingestion and Library Workspace APIs', () => {
	let eventId: number;

	beforeAll(async () => {
		authorHeaders.cookie = await operatorSessionCookie();
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
		const initiationBody = graphicsIngestionRequest({
			idempotencyKey: 'integration-scoreboard-logo',
			name: 'Integration scoreboard logo',
			defaultEventId: eventId,
			browserDecodeEvidence: browserDecodeEvidence(transparentPixelPng),
			declaredByteLength: transparentPixelPng.byteLength,
		});
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
			headers: authorHeaders,
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
		await expectResponseStatus(uploadResponse, 200);
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
			headers: authorHeaders,
			query: { search: 'scoreboard' },
		});
		expect(assets).toEqual([
			expect.objectContaining({
				name: 'Integration scoreboard logo',
				eventIds: [eventId],
				operation: completed,
			}),
		]);

		const thumbnail = await fetch(
			`/api/graphics-assets/${completed.result!.assetId}/thumbnail`,
			{ headers: authorHeaders },
		);
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
		expect(pinnedContent.headers.get('cache-control')).toBe('private, max-age=0, must-revalidate');
		expect(pinnedContent.headers.get('accept-ranges')).toBe('bytes');
		expect(pinnedContent.headers.get('etag')).toBeTruthy();
		expect(new Uint8Array(await pinnedContent.arrayBuffer())).toEqual(transparentPixelPng);

		const missingRevision = await fetch(
			`/api/graphics-assets/${completed.result!.assetId}/revisions/missing-revision/content`,
			{ headers: authorHeaders },
		);
		expect(missingRevision.status).toBe(404);

		const duplicate = await $fetch<GraphicsIngestionOperation>('/api/graphics-assets/ingestion-operations', {
			method: 'POST',
			headers: authorHeaders,
			body: graphicsIngestionRequest({
				idempotencyKey: 'integration-duplicate-scoreboard-logo',
				name: 'Duplicate upload name',
				defaultEventId: eventId,
				// The one ingestion in the integration suites that asks for reuse,
				// because reuse is what it is asserting. Every other initiation takes
				// `graphicsIngestionRequest`'s `create-separate` default.
				duplicateContentPolicy: 'reuse',
				browserDecodeEvidence: browserDecodeEvidence(transparentPixelPng),
				declaredByteLength: transparentPixelPng.byteLength,
			}),
		});
		const duplicateResponse = await fetch(
			`/api/graphics-assets/ingestion-operations/${duplicate.id}/content`,
			{ method: 'PUT', headers: authorHeaders, body: transparentPixelPng },
		);
		await expectResponseStatus(duplicateResponse, 200);
		const reused = await duplicateResponse.json() as GraphicsIngestionOperation;
		expect(reused.result).toEqual({
			outcome: 'reused',
			assetId: completed.result!.assetId,
			revisionId: completed.result!.revisionId,
		});
		await expect($fetch<GraphicAsset[]>('/api/graphics-assets', {
			headers: authorHeaders,
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
			body: graphicsIngestionRequest({
				idempotencyKey: 'integration-separate-scoreboard-logo',
				name: 'Separate scoreboard logo',
				// Stated rather than defaulted: this is the assertion that
				// `create-separate` publishes a second identity over shared content,
				// so it must not be reading the helper's default back to itself.
				duplicateContentPolicy: 'create-separate',
				browserDecodeEvidence: browserDecodeEvidence(transparentPixelPng),
				declaredByteLength: transparentPixelPng.byteLength,
			}),
		});
		const separateResponse = await fetch(
			`/api/graphics-assets/ingestion-operations/${separate.id}/content`,
			{ method: 'PUT', headers: authorHeaders, body: transparentPixelPng },
		);
		await expectResponseStatus(separateResponse, 200);
		const separatelyPublished = await separateResponse.json() as GraphicsIngestionOperation;
		expect(separatelyPublished.result).toMatchObject({ outcome: 'published' });
		expect(separatelyPublished.result?.assetId).not.toBe(completed.result?.assetId);
		await expect($fetch<GraphicAsset[]>('/api/graphics-assets', {
			headers: authorHeaders,
			query: { search: 'scoreboard' },
		})).resolves.toHaveLength(2);
	});

	it('resumes a multipart transfer from server-verified parts and tolerates an ambiguous duplicate request', async () => {
		const bytes = new Uint8Array(GRAPHICS_MULTIPART_PART_BYTES + 1);
		const initiated = await $fetch<GraphicsIngestionOperation>('/api/graphics-assets/ingestion-operations', {
			method: 'POST',
			headers: authorHeaders,
			body: graphicsIngestionRequest({
				idempotencyKey: 'integration-resumable-large-image',
				name: 'Interrupted large image',
				declaredMime: 'image/png',
				browserDecodeEvidence: rejectedBrowserDecodeEvidence(bytes),
				declaredByteLength: bytes.byteLength,
			}),
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
		await expectResponseStatus(firstResponse, 200);
		// Simulate an ambiguous success: the caller loses the response body and
		// must recover solely from the server's durable checkpoint.
		await firstResponse.body?.cancel();

		const reconnected = await $fetch<GraphicsIngestionOperation>(
			`/api/graphics-assets/ingestion-operations/${initiated.id}`,
			{ headers: authorHeaders },
		);
		expect(reconnected).toMatchObject({
			transferredByteLength: GRAPHICS_MULTIPART_PART_BYTES,
			transfer: {
				completedParts: [
					{
						partNumber: 1,
						partIdentity: `${initiated.id}:1`,
						byteLength: GRAPHICS_MULTIPART_PART_BYTES,
					},
				],
			},
		});
		const resumed = await $fetch<GraphicsIngestionOperation>(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/multipart`,
			{ method: 'POST', headers: authorHeaders },
		);
		expect(resumed).toEqual(reconnected);

		const duplicateResponse = await fetch(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/multipart/parts/1`,
			{ method: 'PUT', headers: authorHeaders, body: firstPart },
		);
		await expectResponseStatus(duplicateResponse, 200);
		await expect(duplicateResponse.json()).resolves.toEqual(reconnected);

		const finalResponse = await fetch(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/multipart/parts/2`,
			{
				method: 'PUT',
				headers: authorHeaders,
				body: bytes.subarray(GRAPHICS_MULTIPART_PART_BYTES),
			},
		);
		await expectResponseStatus(finalResponse, 200);
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
				issues: [
					{ code: 'unsupported-image-format' },
				],
			},
			failure: { code: 'validation-failed', retryable: false },
		});
	});

	it('cancels active multipart state idempotently without publishing catalogue state', async () => {
		const initiated = await $fetch<GraphicsIngestionOperation>('/api/graphics-assets/ingestion-operations', {
			method: 'POST',
			headers: authorHeaders,
			body: graphicsIngestionRequest({
				idempotencyKey: 'integration-cancelled-multipart-image',
				name: 'Cancelled multipart image',
				declaredByteLength: GRAPHICS_MULTIPART_PART_BYTES + 1,
			}),
		});
		await $fetch(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/multipart`,
			{ method: 'POST', headers: authorHeaders },
		);

		const cancelled = await $fetch<GraphicsIngestionOperation>(
			`/api/graphics-assets/ingestion-operations/${initiated.id}`,
			{ method: 'DELETE', headers: authorHeaders },
		);
		const cancelledAgain = await $fetch<GraphicsIngestionOperation>(
			`/api/graphics-assets/ingestion-operations/${initiated.id}`,
			{ method: 'DELETE', headers: authorHeaders },
		);
		expect(cancelled).toMatchObject({
			stage: 'cancelled',
			transferredByteLength: 0,
			failure: { code: 'ingestion-cancelled', retryable: false },
			transfer: { cleanupPending: false },
		});
		expect(cancelledAgain).toEqual(cancelled);
		await expect($fetch<GraphicAsset[]>('/api/graphics-assets', {
			headers: authorHeaders,
			query: { search: 'cancelled multipart image' },
		})).resolves.toEqual([]);
	});

	it('exposes cancellation and permanent validation failure as structured operations', async () => {
		const cancelled = await $fetch<GraphicsIngestionOperation>('/api/graphics-assets/ingestion-operations', {
			method: 'POST',
			headers: authorHeaders,
			body: graphicsIngestionRequest({
				idempotencyKey: 'integration-cancelled-logo',
				name: 'Cancelled integration logo',
				declaredByteLength: transparentPixelPng.byteLength,
			}),
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
			body: graphicsIngestionRequest({
				idempotencyKey: 'integration-invalid-logo',
				name: 'Invalid integration logo',
				browserDecodeEvidence: rejectedBrowserDecodeEvidence(invalidBytes),
				declaredByteLength: invalidBytes.byteLength,
			}),
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
				issues: [
					{ code: 'unsupported-image-format' },
				],
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
			body: graphicsIngestionRequest({
				idempotencyKey: 'integration-conflicting-png-mime',
				name: 'Conflicting MIME',
				browserDecodeEvidence: browserDecodeEvidence(transparentPixelPng),
				declaredByteLength: transparentPixelPng.byteLength,
			}),
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
				issues: [
					{ code: 'conflicting-image-mime' },
				],
			},
			failure: { code: 'validation-failed', retryable: false },
		});
	});

	// One profile refusal proves the validator sits behind the seam; each rule is its own unit test.
	it('rejects a truncated JPEG through the durable public ingestion seam', async () => {
		const bytes = jpegPixel.subarray(0, -1);
		const initiated = await $fetch<GraphicsIngestionOperation>('/api/graphics-assets/ingestion-operations', {
			method: 'POST',
			headers: authorHeaders,
			body: graphicsIngestionRequest({
				idempotencyKey: 'integration-profile-rejection-partial-jpeg',
				name: 'Rejected partial JPEG',
				sourceFileName: 'partial.jpg',
				declaredMime: 'image/jpeg',
				browserDecodeEvidence: rejectedBrowserDecodeEvidence(bytes),
				declaredByteLength: bytes.byteLength,
			}),
		});
		const response = await fetch(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/content`,
			{
				method: 'PUT',
				headers: { ...authorHeaders, 'content-type': 'image/jpeg' },
				body: bytes,
			},
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			stage: 'failed',
			report: {
				outcome: 'rejected',
				issues: [
					{ code: 'incomplete-jpeg-frame' },
				],
			},
			failure: { code: 'validation-failed', retryable: false },
		});
		await expect($fetch<GraphicAsset[]>('/api/graphics-assets', {
			headers: authorHeaders,
			query: { search: 'Rejected partial JPEG' },
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
			body: graphicsIngestionRequest({
				idempotencyKey: `integration-${format}-image`,
				name: `Integration ${label} image`,
				sourceFileName: fileName,
				declaredMime: mime,
				browserDecodeEvidence: browserDecodeEvidence(bytes),
				declaredByteLength: bytes.byteLength,
			}),
		});
		const response = await fetch(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/content`,
			{
				method: 'PUT',
				headers: { ...authorHeaders, 'content-type': mime },
				body: bytes,
			},
		);

		await expectResponseStatus(response, 200);
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

		const thumbnail = await fetch(
			`/api/graphics-assets/${completed.result!.assetId}/thumbnail`,
			{ headers: authorHeaders },
		);
		expect(thumbnail.status).toBe(200);
		expect(thumbnail.headers.get('content-type')).toBe('image/png');
		expect(Array.from(new Uint8Array(await thumbnail.arrayBuffer()).slice(0, 8)))
			.toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
	});

	it('publishes and privately delivers one exact verified font revision', async () => {
		const bytes = new Uint8Array(await readFile('public/fonts/mplantin.woff'));
		const initiated = await $fetch<GraphicsIngestionOperation>('/api/graphics-assets/ingestion-operations', {
			method: 'POST',
			headers: authorHeaders,
			body: graphicsIngestionRequest({
				idempotencyKey: 'integration-mplantin-font',
				name: 'Integration MPlantin',
				sourceFileName: 'mplantin.woff',
				declaredMime: 'font/woff',
				declaredByteLength: bytes.byteLength,
			}),
		});
		const response = await fetch(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/content`,
			{
				method: 'PUT',
				headers: { ...authorHeaders, 'content-type': 'font/woff' },
				body: bytes,
			},
		);
		expect(response.status).toBe(200);
		const awaitingEvidence = await response.json() as GraphicsIngestionOperation;
		expect(awaitingEvidence).toMatchObject({
			stage: 'awaiting-confirmation',
			report: {
				outcome: 'accepted',
				facts: { kind: 'font' },
			},
		});
		if (awaitingEvidence.report?.outcome !== 'accepted' || awaitingEvidence.report.facts.kind !== 'font')
			throw new Error('Expected a server-selected font challenge');
		const exact = '1'.repeat(64);
		const completed = await $fetch<GraphicsIngestionOperation>(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/font-browser-evidence`,
			{
				method: 'POST',
				headers: authorHeaders,
				body: {
					outcome: 'font-loaded',
					sourceDigest: createHash('sha256').update(bytes).digest('hex'),
					challengeDigest: awaitingEvidence.report.facts.browserChallenge.digest,
					glyphProofs: awaitingEvidence.report.facts.browserChallenge.codePoints.map(codePoint => ({
						codePoint,
						exactWithSansDigest: exact,
						exactWithMonoDigest: exact,
						sansFallbackDigest: '2'.repeat(64),
						monoFallbackDigest: '3'.repeat(64),
					})),
				},
			},
		);
		expect(completed).toMatchObject({
			stage: 'completed',
			report: {
				outcome: 'accepted',
				compatibilityProfile: 'static-font-v1',
				facts: {
					kind: 'font',
					format: 'woff',
					family: 'MPlantin',
					browserLoadable: true,
					representativeGlyphsRendered: true,
				},
			},
		});

		const discovered = await $fetch<GraphicAsset[]>('/api/graphics-assets', {
			headers: authorHeaders,
			query: { search: 'Integration MPlantin' },
		});
		expect(discovered).toMatchObject([
			{
				kind: 'font',
				revisionId: completed.result!.revisionId,
			},
		]);
		const content = await fetch(
			`/api/graphics-assets/${completed.result!.assetId}/revisions/${completed.result!.revisionId}/content`,
			{ headers: authorHeaders },
		);
		expect(content.status).toBe(200);
		expect(content.headers.get('content-type')).toBe('font/woff');
		expect(new Uint8Array(await content.arrayBuffer())).toEqual(bytes);
	});
});
