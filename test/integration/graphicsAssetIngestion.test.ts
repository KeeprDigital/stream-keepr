import type {
	GraphicAsset,
	GraphicsIngestionOperation,
} from '~~/shared/types/graphicsAsset';
import { Buffer } from 'node:buffer';
import { $fetch, fetch } from '@nuxt/test-utils/e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
