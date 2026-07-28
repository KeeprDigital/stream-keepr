import type { GraphicsAssetLibraryCapacity, GraphicsIngestionOperation } from '~~/shared/types/graphicsAsset';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { $fetch, fetch } from '@nuxt/test-utils/e2e';
import { describe, expect, it } from 'vitest';
import { INTEGRATION_GRAPHICS_ADMIN_TOKEN } from './helpers';

describe('the Graphics Asset Library Capacity API', () => {
	const administratorHeaders = {
		'x-graphics-admin-token': INTEGRATION_GRAPHICS_ADMIN_TOKEN,
	};
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
		const unauthorizedAdminMutation = await fetch('/api/admin/graphics-assets/capacity', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(updatedLimits),
		});
		expect(unauthorizedAdminMutation.status).toBe(403);

		try {
			const updated = await $fetch<GraphicsAssetLibraryCapacity>(
				'/api/admin/graphics-assets/capacity',
				{ method: 'PUT', headers: administratorHeaders, body: updatedLimits },
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
				headers: administratorHeaders,
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
				headers: administratorHeaders,
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
				headers: administratorHeaders,
				body: {
					canonicalLimitBytes: original.canonical.limitBytes,
					stagingLimitBytes: original.staging.limitBytes,
				},
			});
		}
	});

	it('allows a proven no-growth publication through D1 at the full Canonical Graphics Quota', async () => {
		const original = await $fetch<GraphicsAssetLibraryCapacity>('/api/graphics-assets/capacity');
		const authorHeaders = { 'x-graphics-author-id': 'capacity-no-growth-author' };
		const noGrowthBytes = pngWithTextChunks(10);
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
						browserDecodeEvidence: browserDecodeEvidence(noGrowthBytes),
						declaredByteLength: noGrowthBytes.byteLength,
					},
				},
			);
			const response = await fetch(
				`/api/graphics-assets/ingestion-operations/${operation.id}/content`,
				{ method: 'PUT', headers: authorHeaders, body: noGrowthBytes },
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
				headers: administratorHeaders,
				body: {
					canonicalLimitBytes: occupied.canonical.usedBytes,
					stagingLimitBytes: occupied.staging.limitBytes,
				},
			});

			const noGrowth = await upload(`capacity-no-growth-${crypto.randomUUID()}`);
			expect(noGrowth).toMatchObject({
				stage: 'completed',
				canonicalCapacityOutcome: {
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
				headers: administratorHeaders,
				body: {
					canonicalLimitBytes: original.canonical.limitBytes,
					stagingLimitBytes: original.staging.limitBytes,
				},
			});
		}
	});

	it('allows only one of two competing D1 publications through the hard limit', async () => {
		const original = await $fetch<GraphicsAssetLibraryCapacity>('/api/graphics-assets/capacity');
		const authorHeaders = { 'x-graphics-author-id': 'capacity-concurrency-author' };
		const initiate = async (idempotencyKey: string, bytes: Uint8Array) =>
			await $fetch<GraphicsIngestionOperation>(
				'/api/graphics-assets/ingestion-operations',
				{
					method: 'POST',
					headers: authorHeaders,
					body: {
						idempotencyKey,
						name: idempotencyKey,
						duplicateContentPolicy: 'create-separate',
						browserDecodeEvidence: browserDecodeEvidence(bytes),
						declaredByteLength: bytes.byteLength,
					},
				},
			);
		const upload = async (operation: GraphicsIngestionOperation, bytes: Uint8Array) => {
			const response = await fetch(
				`/api/graphics-assets/ingestion-operations/${operation.id}/content`,
				{ method: 'PUT', headers: authorHeaders, body: bytes },
			);
			expect(response.status).toBe(200);
			return await response.json() as GraphicsIngestionOperation;
		};

		try {
			const foundationBytes = pngWithTextChunks(20);
			const foundation = await initiate(
				`capacity-concurrency-foundation-${crypto.randomUUID()}`,
				foundationBytes,
			);
			await upload(foundation, foundationBytes);
			const before = await $fetch<GraphicsAssetLibraryCapacity>(
				'/api/graphics-assets/capacity',
			);
			const firstBytes = pngWithTextChunks(21);
			const secondBytes = pngWithTextChunks(22);
			const hardLimit = before.canonical.usedBytes
				+ Math.max(firstBytes.byteLength, secondBytes.byteLength);
			const [first, second] = await Promise.all([
				initiate(`capacity-concurrency-first-${crypto.randomUUID()}`, firstBytes),
				initiate(`capacity-concurrency-second-${crypto.randomUUID()}`, secondBytes),
			]);
			await $fetch('/api/admin/graphics-assets/capacity', {
				method: 'PUT',
				headers: administratorHeaders,
				body: {
					canonicalLimitBytes: hardLimit,
					stagingLimitBytes: before.staging.limitBytes,
				},
			});

			const outcomes = await Promise.all([
				upload(first, firstBytes),
				upload(second, secondBytes),
			]);

			expect(outcomes.filter(outcome => outcome.stage === 'completed')).toHaveLength(1);
			expect(outcomes.filter(
				outcome => outcome.failure?.code === 'canonical-capacity-exhausted',
			)).toHaveLength(1);
			const after = await $fetch<GraphicsAssetLibraryCapacity>(
				'/api/graphics-assets/capacity',
			);
			expect(after.canonical.usedBytes).toBeLessThanOrEqual(hardLimit);
			expect(after.canonical.reservedBytes).toBe(0);
		}
		finally {
			await $fetch('/api/admin/graphics-assets/capacity', {
				method: 'PUT',
				headers: administratorHeaders,
				body: {
					canonicalLimitBytes: original.canonical.limitBytes,
					stagingLimitBytes: original.staging.limitBytes,
				},
			});
		}
	});
});
