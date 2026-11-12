import type {
	GraphicsIngestionOperation,
	GraphicsOperationalQueuesOverview,
	GraphicsQueueInspection,
} from '~~/shared/types/graphicsAsset';
import type { GraphicsQueueActionOutcome } from '~~/shared/utils/graphicsOperationalQueues';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { GRAPHICS_OPERATIONAL_QUEUES } from '../../shared/utils/graphicsOperationalQueues';
import { $fetch, fetch, operatorSessionCookie } from './client';
import { graphicsIngestionRequest } from './graphicsIngestionRequest';
import { INTEGRATION_GRAPHICS_ADMIN_TOKEN } from './helpers';
import { expectOperationResult, expectResponseStatus } from './responseStatus';

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
		authorHeaders = { cookie: await operatorSessionCookie() };
	});

	async function ingest(name: string, idempotencyKey: string, bytes: Uint8Array<ArrayBuffer>) {
		const initiated = await $fetch<GraphicsIngestionOperation>(
			'/api/graphics-assets/ingestion-operations',
			{
				method: 'POST',
				headers: authorHeaders,
				body: graphicsIngestionRequest({
					idempotencyKey,
					name,
					sourceFileName: 'logo.png',
					declaredMime: 'image/png',
					browserDecodeEvidence: decodeEvidence(bytes),
					declaredByteLength: bytes.byteLength,
				}),
			},
		);
		return await fetch(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/content`,
			{
				method: 'PUT',
				headers: { ...authorHeaders, 'content-type': 'image/png' },
				body: bytes,
			},
		).then(expectOperationResult);
	}

	/** The queue's own action: restoration, reported in the outcome vocabulary. */
	async function restore(assetId: string) {
		return await $fetch<QueueActionResult>(
			`/api/admin/graphics-assets/${assetId}/lifecycle-actions`,
			{
				method: 'POST',
				headers: administratorHeaders,
				body: { action: 'restore' },
			},
		);
	}

	/** How assets actually reach Retired and Trash: the Library Workspace. */
	async function authorLifecycleAction(assetId: string, action: 'retire' | 'trash') {
		return await fetch(`/api/graphics-assets/${assetId}/lifecycle-actions`, {
			method: 'POST',
			headers: { ...authorHeaders, 'content-type': 'application/json' },
			body: JSON.stringify({ action }),
		}).then(async (response) => {
			await expectResponseStatus(response, 200);
			return await response.json() as { outcome: string };
		});
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
			},
		);
		expect(retry.status).toBe(403);
	});

	it('offers restoration alone, not every lifecycle transition', async () => {
		const refused = await fetch('/api/admin/graphics-assets/anything/lifecycle-actions', {
			method: 'POST',
			headers: { ...administratorHeaders, 'content-type': 'application/json' },
			body: JSON.stringify({ action: 'trash' }),
		});
		// Retiring and Trashing are the Library Workspace's decisions about a live
		// asset. No queue offers them, so this surface does not accept them.
		expect(refused.status).toBe(400);
	});

	// Wiring: the reading's order, counts and contents are `graphicsOperationalQueues.sqlite.test.ts`'s.
	it('answers a Graphics Administrator the reading of every queue', async () => {
		const overview = await $fetch<GraphicsOperationalQueuesOverview>(
			'/api/admin/graphics-assets/queues',
			{ headers: administratorHeaders },
		);

		expect(overview.queues.map(queue => queue.id))
			.toEqual([...GRAPHICS_OPERATIONAL_QUEUES]);
	});

	it('inspects a Retired asset and reports restoration exactly once', async () => {
		const operation = await ingest('Queues retired logo', 'queues-retired', queuesRetiredPng);
		const assetId = operation.result!.assetId;
		expect(await authorLifecycleAction(assetId, 'retire')).toMatchObject({ outcome: 'retired' });

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

		expect(await restore(assetId)).toEqual({ outcome: 'completed' });
		// The same action again is the idempotent no-op, reported as such rather
		// than as a second success or a bare error.
		expect(await restore(assetId)).toEqual({ outcome: 'already-in-state' });

		// The asset left the queue it was in, so it can no longer be inspected there.
		const gone = await fetch(
			`/api/admin/graphics-assets/queues/inspection?queue=retired-asset&subjectId=${assetId}`,
			{ headers: administratorHeaders },
		);
		expect(gone.status).toBe(404);
	});

	it('reports an ingestion retry that has nothing left to resume', async () => {
		const operation = await ingest('Queues retry logo', 'queues-retry', pngWithTextChunks(63));

		// A completed operation is terminal: retrying it is the idempotent no-op.
		const retried = await $fetch<QueueActionResult>(
			`/api/admin/graphics-assets/ingestion-operations/${operation.id}/retry`,
			{ method: 'POST', headers: administratorHeaders },
		);
		expect(retried).toEqual({ outcome: 'already-in-state' });
	});
});
