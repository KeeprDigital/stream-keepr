import type {
	GraphicAsset,
	GraphicsIngestionOperation,
} from '~~/shared/types/graphicsAsset';
import { Buffer } from 'node:buffer';
import { $fetch, fetch } from '@nuxt/test-utils/e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const authorHeaders = { 'x-graphics-author-id': 'integration-graphics-author' };
const transparentPixelPng = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
));

describe('the bounded PNG ingestion and Library Workspace APIs', () => {
	let eventId: number;

	beforeAll(async () => {
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

		const invalidBytes = new TextEncoder().encode('not a PNG');
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
				issues: [{ code: 'invalid-png-signature' }],
			},
			failure: { code: 'validation-failed', retryable: false },
		});
	});

	it('rejects a declared PNG transfer above 16 MiB before route code consumes it', async () => {
		const response = await fetch('/api/graphics-assets/ingestion-operations/not-created/content', {
			method: 'PUT',
			headers: authorHeaders,
			body: new Uint8Array(16 * 1024 * 1024 + 1),
		});

		expect(response.status).toBe(413);
	});

	it('rejects source bytes whose declared MIME conflicts with PNG', async () => {
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

		expect(response.status).toBe(415);
	});
});
