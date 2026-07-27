import type { GraphicsAssetLibraryCapacity, GraphicsIngestionOperation } from '~~/shared/types/graphicsAsset';
import { Buffer } from 'node:buffer';
import { $fetch, fetch } from '@nuxt/test-utils/e2e';
import { describe, expect, it } from 'vitest';

describe('graphics Asset Library capacity API', () => {
	const transparentPixelPng = Uint8Array.from(Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
		'base64',
	));

	it('exposes author-readable capacity while changes remain on the administrator surface', async () => {
		const original = await $fetch<GraphicsAssetLibraryCapacity>('/api/graphics-assets/capacity');
		const updatedLimits = {
			canonicalLimitBytes: original.canonical.limitBytes + 1024,
			stagingLimitBytes: original.staging.limitBytes + 1024,
		};

		const publicMutation = await fetch('/api/graphics-assets/capacity', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(updatedLimits),
		});
		expect(publicMutation.status).toBe(403);

		try {
			const updated = await $fetch<GraphicsAssetLibraryCapacity>(
				'/api/admin/graphics-assets/capacity',
				{ method: 'PUT', body: updatedLimits },
			);
			expect(updated).toMatchObject({
				canonical: { limitBytes: updatedLimits.canonicalLimitBytes },
				staging: { limitBytes: updatedLimits.stagingLimitBytes },
			});
			await expect(
				$fetch<GraphicsAssetLibraryCapacity>('/api/graphics-assets/capacity'),
			).resolves.toEqual(updated);
		}
		finally {
			await $fetch('/api/admin/graphics-assets/capacity', {
				method: 'PUT',
				body: {
					canonicalLimitBytes: original.canonical.limitBytes,
					stagingLimitBytes: original.staging.limitBytes,
				},
			});
		}
	});

	it('returns structured insufficient-storage details when staging admission is full', async () => {
		const original = await $fetch<GraphicsAssetLibraryCapacity>('/api/graphics-assets/capacity');
		const occupiedStagingBytes = original.staging.usedBytes + original.staging.reservedBytes;

		try {
			await $fetch('/api/admin/graphics-assets/capacity', {
				method: 'PUT',
				body: {
					canonicalLimitBytes: original.canonical.limitBytes,
					stagingLimitBytes: occupiedStagingBytes + 1,
				},
			});
			const response = await fetch('/api/graphics-assets/ingestion-operations', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'x-graphics-author-id': 'capacity-integration-author',
				},
				body: JSON.stringify({
					idempotencyKey: `capacity-blocked-${crypto.randomUUID()}`,
					name: 'Blocked staging operation',
					declaredByteLength: 68,
				}),
			});

			expect(response.status).toBe(507);
			await expect(response.json()).resolves.toMatchObject({
				statusCode: 507,
				statusMessage: 'Insufficient Storage',
				data: {
					resource: 'staging',
					limitBytes: occupiedStagingBytes + 1,
					requestedBytes: 68,
					availableBytes: 1,
				},
			});
		}
		finally {
			await $fetch('/api/admin/graphics-assets/capacity', {
				method: 'PUT',
				body: {
					canonicalLimitBytes: original.canonical.limitBytes,
					stagingLimitBytes: original.staging.limitBytes,
				},
			});
		}
	});

	it('allows a proven no-growth publication through D1 at full canonical quota', async () => {
		const original = await $fetch<GraphicsAssetLibraryCapacity>('/api/graphics-assets/capacity');
		const authorHeaders = { 'x-graphics-author-id': 'capacity-no-growth-author' };
		const upload = async (idempotencyKey: string) => {
			const operation = await $fetch<GraphicsIngestionOperation>(
				'/api/graphics-assets/ingestion-operations',
				{
					method: 'POST',
					headers: authorHeaders,
					body: {
						idempotencyKey,
						name: idempotencyKey,
						duplicateContentPolicy: 'create-separate',
						declaredByteLength: transparentPixelPng.byteLength,
					},
				},
			);
			const response = await fetch(
				`/api/graphics-assets/ingestion-operations/${operation.id}/content`,
				{ method: 'PUT', headers: authorHeaders, body: transparentPixelPng },
			);
			expect(response.status).toBe(200);
			return await response.json() as GraphicsIngestionOperation;
		};

		try {
			await upload(`capacity-foundation-${crypto.randomUUID()}`);
			const occupied = await $fetch<GraphicsAssetLibraryCapacity>(
				'/api/graphics-assets/capacity',
			);
			await $fetch('/api/admin/graphics-assets/capacity', {
				method: 'PUT',
				body: {
					canonicalLimitBytes: occupied.canonical.usedBytes,
					stagingLimitBytes: occupied.staging.limitBytes,
				},
			});

			const noGrowth = await upload(`capacity-no-growth-${crypto.randomUUID()}`);
			expect(noGrowth).toMatchObject({
				stage: 'completed',
				capacity: {
					outcome: 'no-canonical-growth',
					growthBytes: 0,
					availableBytes: 0,
				},
				result: { outcome: 'published' },
			});
		}
		finally {
			await $fetch('/api/admin/graphics-assets/capacity', {
				method: 'PUT',
				body: {
					canonicalLimitBytes: original.canonical.limitBytes,
					stagingLimitBytes: original.staging.limitBytes,
				},
			});
		}
	});
});
