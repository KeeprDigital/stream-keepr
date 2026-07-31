import type {
	GraphicAssetPurgeOutcome,
	GraphicsIngestionOperation,
	GraphicsOperationalQueuesOverview,
	GraphicsQueueInspection,
} from '~~/shared/types/graphicsAsset';
import type { GraphicsQueueActionOutcome } from '~~/shared/utils/graphicsOperationalQueues';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { $fetch, fetch } from '@nuxt/test-utils/e2e';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '../../shared/types/screenConfig';
import { GRAPHICS_OPERATIONAL_QUEUES } from '../../shared/utils/graphicsOperationalQueues';
import { createGraphicsAuthorSessionCookie } from './graphicsAuthorSession';
import { INTEGRATION_GRAPHICS_ADMIN_TOKEN } from './helpers';

const transparentPixelPng = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
));
const emptyTextChunk = Uint8Array.of(0, 0, 0, 0, 0x74, 0x45, 0x58, 0x74, 0x96, 0x42, 0xC5, 0x85);

/**
 * Integration suites share one database and identical bytes deduplicate by
 * design, so this suite pads its fixtures with chunk counts no other suite uses.
 */
function pngWithTextChunks(count: number) {
	return Uint8Array.from(Buffer.concat([
		transparentPixelPng.slice(0, -12),
		...Array.from({ length: count }).fill(emptyTextChunk) as Uint8Array[],
		transparentPixelPng.slice(-12),
	]));
}

const queuesRetiredPng = pngWithTextChunks(60);
const queuesTrashedPng = pngWithTextChunks(61);
const queuesReferencedPng = pngWithTextChunks(62);

function decodeEvidence(bytes: Uint8Array) {
	return {
		outcome: 'decoded' as const,
		sourceDigest: createHash('sha256').update(bytes).digest('hex'),
		width: 1,
		height: 1,
	};
}

interface QueueActionResult {
	outcome: GraphicsQueueActionOutcome;
}

describe('the Graphics Asset Library operational queues API', () => {
	const administratorHeaders = {
		'x-graphics-admin-token': INTEGRATION_GRAPHICS_ADMIN_TOKEN,
	};
	let authorHeaders: Record<string, string>;

	beforeAll(async () => {
		authorHeaders = {
			'cookie': await createGraphicsAuthorSessionCookie(),
			'x-graphics-author-id': 'queues-integration-author',
		};
	});

	async function ingest(name: string, idempotencyKey: string, bytes: Uint8Array) {
		const initiated = await $fetch<GraphicsIngestionOperation>(
			'/api/graphics-assets/ingestion-operations',
			{
				method: 'POST',
				headers: authorHeaders,
				body: {
					idempotencyKey,
					name,
					duplicateContentPolicy: 'create-separate',
					sourceFileName: 'logo.png',
					declaredMime: 'image/png',
					browserDecodeEvidence: decodeEvidence(bytes),
					declaredByteLength: bytes.byteLength,
				},
			},
		);
		return await fetch(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/content`,
			{
				method: 'PUT',
				headers: { ...authorHeaders, 'content-type': 'image/png' },
				body: bytes,
			},
		).then(response => response.json() as Promise<GraphicsIngestionOperation>);
	}

	async function act(assetId: string, action: string, extra: Record<string, unknown> = {}) {
		return await $fetch<QueueActionResult>(
			`/api/admin/graphics-assets/${assetId}/lifecycle-actions`,
			{ method: 'POST', headers: administratorHeaders, body: { action, ...extra } },
		);
	}

	it('keeps every queue surface administrator-only', async () => {
		const overview = await fetch('/api/admin/graphics-assets/queues');
		expect(overview.status).toBe(403);
		const inspection = await fetch(
			'/api/admin/graphics-assets/queues/inspection?queue=retired-asset&subjectId=x',
		);
		expect(inspection.status).toBe(403);
		const lifecycle = await fetch('/api/admin/graphics-assets/x/lifecycle-actions', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ action: 'restore' }),
		});
		expect(lifecycle.status).toBe(403);
		const retry = await fetch(
			'/api/admin/graphics-assets/ingestion-operations/x/retry',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ initiatedBy: 'queues-integration-author' }),
			},
		);
		expect(retry.status).toBe(403);
	});

	it('states every queue in risk order with its complete count', async () => {
		const overview = await $fetch<GraphicsOperationalQueuesOverview>(
			'/api/admin/graphics-assets/queues',
			{ headers: administratorHeaders },
		);

		expect(overview.queues.map(queue => queue.id))
			.toEqual([...GRAPHICS_OPERATIONAL_QUEUES]);
		expect(overview.authority).toEqual({
			expectedReachability: 'catalogue',
			presentBytes: 'byte-store',
			contentAvailabilityFlag: 'advisory-reconciliation-state',
		});
		for (const queue of overview.queues)
			expect(queue.totalCount).toBeGreaterThanOrEqual(queue.items.length);

		// No provider detail reaches an administrator surface.
		const serialized = JSON.stringify(overview);
		expect(serialized).not.toContain('sha256/');
		expect(serialized).not.toContain('adopt');
	});

	it('inspects a Retired asset and reports restoration exactly once', async () => {
		const operation = await ingest('Queues retired logo', 'queues-retired', queuesRetiredPng);
		const assetId = operation.result!.assetId;
		expect(await act(assetId, 'retire')).toEqual({ outcome: 'completed' });

		const inspection = await $fetch<GraphicsQueueInspection>(
			'/api/admin/graphics-assets/queues/inspection',
			{
				headers: administratorHeaders,
				query: { queue: 'retired-asset', subjectId: assetId },
			},
		);
		expect(inspection).toMatchObject({
			queue: 'retired-asset',
			subject: { kind: 'graphic-asset', id: assetId },
			title: 'Queues retired logo',
			referenceCount: 0,
			// Retirement is reversible, so restoration is the only valid action.
			actions: ['restore-graphic-asset'],
		});
		expect(inspection.deadline).toBeUndefined();
		expect(inspection.detail).toMatchObject({
			kind: 'graphic-asset',
			lifecycle: { state: 'retired' },
		});

		expect(await act(assetId, 'restore')).toEqual({ outcome: 'completed' });
		// The same action again is the idempotent no-op, reported as such rather
		// than as a second success or a bare error.
		expect(await act(assetId, 'restore')).toEqual({ outcome: 'already-in-state' });

		// The asset left the queue it was in, so it can no longer be inspected there.
		const gone = await fetch(
			`/api/admin/graphics-assets/queues/inspection?queue=retired-asset&subjectId=${assetId}`,
			{ headers: administratorHeaders },
		);
		expect(gone.status).toBe(404);
	});

	it('reports a Trash blocked by pinned usage as reference-blocked', async () => {
		const event = await $fetch<{ id: number }>('/api/events', {
			method: 'POST',
			body: {
				name: 'Graphic Asset Queues Event',
				game: 'mtg',
				featureMatchOrientation: 'horizontal',
			},
		});
		try {
			const screen = await $fetch<{ id: number }>(`/api/events/${event.id}/screens`, {
				method: 'POST',
				body: {
					name: 'Queues overlay',
					slug: `queues-overlay-${event.id}`,
					currentMode: 'feature-match-overlay',
				},
			});
			const operation = await ingest(
				'Queues referenced logo',
				'queues-referenced',
				queuesReferencedPng,
			);
			const assetId = operation.result!.assetId;
			const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
			config.layout.frame.backgroundImage = {
				assetId,
				revisionId: operation.result!.revisionId,
			};
			await $fetch(
				`/api/events/${event.id}/screens/${screen.id}/config/feature-match-overlay`,
				{ method: 'PATCH', body: { layout: config.layout } },
			);

			// A fresh reference proof found pinned usage, so nothing was reclaimed.
			expect(await act(assetId, 'trash')).toEqual({ outcome: 'reference-blocked' });
		}
		finally {
			await $fetch(`/api/events/${event.id}`, { method: 'DELETE' }).catch(() => {});
		}
	});

	it('requires an explicit confirmation before an early purge', async () => {
		const operation = await ingest('Queues trashed logo', 'queues-trashed', queuesTrashedPng);
		const assetId = operation.result!.assetId;
		expect(await act(assetId, 'trash')).toEqual({ outcome: 'completed' });

		// The queue's purge action goes to the existing fresh-proof endpoint, and
		// that endpoint refuses anything but the exact confirmation.
		const unconfirmed = await fetch(`/api/admin/graphics-assets/${assetId}/purge`, {
			method: 'POST',
			headers: { ...administratorHeaders, 'content-type': 'application/json' },
			body: JSON.stringify({ confirmation: 'yes' }),
		});
		expect(unconfirmed.status).toBe(400);

		const purged = await $fetch<GraphicAssetPurgeOutcome>(
			`/api/admin/graphics-assets/${assetId}/purge`,
			{
				method: 'POST',
				headers: administratorHeaders,
				body: { confirmation: 'purge-now' },
			},
		);
		expect(purged).toMatchObject({ outcome: 'purged', referenceCount: 0 });

		// Purging again finds nothing left to purge; the local identity is retired
		// permanently rather than reused.
		const again = await fetch(`/api/admin/graphics-assets/${assetId}/purge`, {
			method: 'POST',
			headers: { ...administratorHeaders, 'content-type': 'application/json' },
			body: JSON.stringify({ confirmation: 'purge-now' }),
		});
		expect(again.status).toBe(404);
	});

	it('reports an ingestion retry that has nothing left to resume', async () => {
		const operation = await ingest('Queues retry logo', 'queues-retry', pngWithTextChunks(63));

		// A completed operation is terminal: retrying it is the idempotent no-op.
		const retried = await $fetch<QueueActionResult>(
			`/api/admin/graphics-assets/ingestion-operations/${operation.id}/retry`,
			{
				method: 'POST',
				headers: administratorHeaders,
				body: { initiatedBy: 'queues-integration-author' },
			},
		);
		expect(retried).toEqual({ outcome: 'already-in-state' });
	});

	it('filters the Evidence ledger to one subject', async () => {
		const operation = await ingest('Queues evidence logo', 'queues-evidence', pngWithTextChunks(64));
		const assetId = operation.result!.assetId;
		await act(assetId, 'trash');
		await $fetch(`/api/admin/graphics-assets/${assetId}/purge`, {
			method: 'POST',
			headers: administratorHeaders,
			body: { confirmation: 'purge-now' },
		});

		const entries = await $fetch<{ subject: { kind: string; id: string } }[]>(
			'/api/admin/graphics-assets/evidence',
			{
				headers: administratorHeaders,
				query: { subjectKind: 'graphic-asset', subjectId: assetId },
			},
		);

		expect(entries.length).toBeGreaterThan(0);
		for (const entry of entries)
			expect(entry.subject).toEqual({ kind: 'graphic-asset', id: assetId });
	});
});
