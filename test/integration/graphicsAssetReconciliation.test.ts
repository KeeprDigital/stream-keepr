import type {
	GraphicsIngestionOperation,
	GraphicsReconciliationOverview,
	GraphicsReconciliationSweepResult,
} from '~~/shared/types/graphicsAsset';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { $fetch, fetch, operatorSessionCookie } from './client';
import { graphicsIngestionRequest } from './graphicsIngestionRequest';
import { INTEGRATION_GRAPHICS_ADMIN_TOKEN } from './helpers';

const transparentPixelPng = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
));
const emptyTextChunk = Uint8Array.of(0, 0, 0, 0, 0x74, 0x45, 0x58, 0x74, 0x96, 0x42, 0xC5, 0x85);

/**
 * Integration suites share one database and identical bytes deduplicate by
 * design, so this suite pads its fixture with a chunk count no other suite uses
 * and keeps its content digests to itself.
 */
const reconciliationPixelPng = Uint8Array.from(Buffer.concat([
	transparentPixelPng.slice(0, -12),
	...Array.from({ length: 40 }).fill(emptyTextChunk) as Uint8Array[],
	transparentPixelPng.slice(-12),
]));

describe('the Graphics Asset Library reconciliation API', () => {
	const administratorHeaders = {
		'x-graphics-admin-token': INTEGRATION_GRAPHICS_ADMIN_TOKEN,
	};
	let authorHeaders: Record<string, string>;

	beforeAll(async () => {
		authorHeaders = { cookie: await operatorSessionCookie() };
	});

	async function ingest(name: string, idempotencyKey: string) {
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
					browserDecodeEvidence: {
						outcome: 'decoded',
						sourceDigest: createHash('sha256').update(reconciliationPixelPng).digest('hex'),
						width: 1,
						height: 1,
					},
					declaredByteLength: reconciliationPixelPng.byteLength,
				}),
			},
		);
		return await fetch(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/content`,
			{
				method: 'PUT',
				headers: { ...authorHeaders, 'content-type': 'image/png' },
				body: reconciliationPixelPng,
			},
		).then(response => response.json() as Promise<GraphicsIngestionOperation>);
	}

	it('keeps every reconciliation surface behind administrator authorization', async () => {
		expect((await fetch('/api/admin/graphics-assets/reconciliation')).status).toBe(403);
		expect((await fetch('/api/admin/graphics-assets/reconciliation', { method: 'POST' })).status)
			.toBe(403);
		expect((await fetch('/api/admin/graphics-assets/discrepancies/anything')).status).toBe(403);
		expect((await fetch('/api/admin/graphics-assets/discrepancies/anything/actions', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ action: 'recheck' }),
		})).status).toBe(403);
		expect((await fetch('/api/admin/graphics-assets/discrepancies/anything/repair', {
			method: 'PUT',
			body: reconciliationPixelPng,
		})).status).toBe(403);
	});

	it('states the authority contract that readers and reconciliation both follow', async () => {
		const overview = await $fetch<GraphicsReconciliationOverview>(
			'/api/admin/graphics-assets/reconciliation',
			{ headers: administratorHeaders },
		);

		expect(overview.authority).toEqual({
			expectedReachability: 'catalogue',
			presentBytes: 'byte-store',
			contentAvailabilityFlag: 'advisory-reconciliation-state',
		});
		expect(overview.openCounts).toMatchObject({
			'unavailable-content': expect.any(Number),
			'missing-derivative': expect.any(Number),
			'unexpected-object': expect.any(Number),
			'critical-integrity-incident': expect.any(Number),
		});
	});

	/**
	 * Scoped to the fixture this test publishes, because the reconciliation sweep
	 * reads the whole library and every integration suite publishes into the same
	 * one. The sweep's counters and the overview's open list therefore describe
	 * rows other files left behind as much as this suite's own, and #123 records
	 * this test failing on exactly that: one open `unavailable-content`
	 * discrepancy with `affectedUsage: []`, over orphaned content nothing here
	 * created. So this pins agreement about one Graphic Asset, not a healthy
	 * library — an unhealthy library is precisely what it now tolerates.
	 *
	 * `affectedUsage` is what makes the scoping possible, and its bound is what
	 * keeps the claim honest. It is built from the revisions and derivatives
	 * reaching the content (`listContentUsageForDigests` unions the two), so a
	 * disagreement about content this asset reaches always names it, while a
	 * foreign orphan — content no revision reaches, the shape that bled in — never
	 * can.
	 *
	 * The bound: `unexpected-object` discrepancies are bytes the catalogue has no
	 * row for, so they are in neither half of that union and carry an empty
	 * `affectedUsage` by construction. **That kind is not covered here**, and it
	 * cannot be, because a discrepancy deliberately exposes no content digest —
	 * see the type's own docblock — so there is nothing on the response to match
	 * this suite's bytes against. It was never really covered before either: the
	 * library-wide counter that used to stand in for it is the thing that bled.
	 * What covers the case that matters — this asset's bytes going missing however
	 * it happened — is the revision status read at the end, which reads the bytes
	 * themselves.
	 *
	 * Paging is a weaker guarantee than it looks, too. The overview takes fifty per
	 * kind ordered `isolated DESC, detected_at DESC, id DESC`, so newest-first is
	 * only a tiebreak below isolation: a fresh disagreement about this fixture
	 * leads its kind unless fifty isolated rows of that same kind precede it, which
	 * makes it unlikely to be paged off rather than impossible. (`unexpected-object`
	 * is ordered by quarantine deadline ascending, where a fresh row sorts last —
	 * another reason the bound above is the honest statement for that kind.)
	 *
	 * The two library-wide counters this used to assert (`unavailableDetected` and
	 * `criticalIntegrityIncidents`) have no scoped form — they are counts over
	 * whatever the batch happened to contain — so the discrepancy list is where
	 * both of those kinds are now caught.
	 */
	it('reports agreement for the Graphic Asset it publishes and invents no state about it', async () => {
		const operation = await ingest('Reconciliation logo', 'reconciliation-healthy');
		expect(operation.stage).toBe('completed');
		const assetId = operation.result!.assetId;

		const sweep = await $fetch<GraphicsReconciliationSweepResult>(
			'/api/admin/graphics-assets/reconciliation',
			{ method: 'POST', headers: administratorHeaders },
		);
		expect(sweep.content.checked).toBeGreaterThan(0);

		// Content this library just published is expected, so nothing the
		// reconciliation sweep opens names this asset.
		const overview = await $fetch<GraphicsReconciliationOverview>(
			'/api/admin/graphics-assets/reconciliation',
			{ headers: administratorHeaders },
		);
		expect(overview.discrepancies.filter(
			discrepancy => discrepancy.affectedUsage.some(usage => usage.assetId === assetId),
		)).toEqual([]);
		expect(overview.lastSweep?.correlationId).toBe(sweep.correlationId);

		// The asset it just checked is still exactly as it was published. This route
		// reads the bytes rather than the catalogue's advisory availability flag, so
		// it fails on a sweep that quarantined or discarded them even in the cases no
		// discrepancy would have named this asset at all — the `unexpected-object`
		// bound above being the one that matters.
		const status = await fetch(
			`/api/graphics-assets/${assetId}/revisions/${operation.result!.revisionId}/status`,
			{ headers: authorHeaders },
		);
		expect(status.status).toBe(200);
		expect(await status.json()).toMatchObject({ outcome: 'available' });
	});

	it('reports an unknown discrepancy identity as not found on every action', async () => {
		expect((await fetch('/api/admin/graphics-assets/discrepancies/unknown', {
			headers: administratorHeaders,
		})).status).toBe(404);
		expect((await fetch('/api/admin/graphics-assets/discrepancies/unknown/actions', {
			method: 'POST',
			headers: { ...administratorHeaders, 'content-type': 'application/json' },
			body: JSON.stringify({ action: 'recheck' }),
		})).status).toBe(404);
		expect((await fetch('/api/admin/graphics-assets/discrepancies/unknown/repair', {
			method: 'PUT',
			headers: { ...administratorHeaders, 'content-type': 'image/png' },
			body: reconciliationPixelPng,
		})).status).toBe(404);
	});

	it('serves the reconciliation half of the Evidence ledger', async () => {
		// The ledger is one ledger. A category filter that only knew the retention
		// half would reject every reconciliation category outright.
		for (const category of [
			'content-unavailable-detected',
			'content-availability-restored',
			'content-repaired',
			'content-restored-from-quarantine',
			'derivative-missing-detected',
			'derivative-regenerated',
			'unexpected-object-quarantined',
			'critical-integrity-incident',
			'discrepancy-rechecked',
			'repair-rejected',
		]) {
			const response = await fetch(
				`/api/admin/graphics-assets/evidence?category=${category}`,
				{ headers: administratorHeaders },
			);
			expect(response.status, `category ${category}`).toBe(200);
		}
		// A retention category still works, and an invented one still does not.
		expect((await fetch('/api/admin/graphics-assets/evidence?category=content-deleted', {
			headers: administratorHeaders,
		})).status).toBe(200);
		expect((await fetch('/api/admin/graphics-assets/evidence?category=not-a-category', {
			headers: administratorHeaders,
		})).status).toBe(400);
	});

	it('rejects an action the domain does not offer', async () => {
		const response = await fetch('/api/admin/graphics-assets/discrepancies/unknown/actions', {
			method: 'POST',
			headers: { ...administratorHeaders, 'content-type': 'application/json' },
			body: JSON.stringify({ action: 'adopt-unexpected-object' }),
		});
		expect(response.status).toBe(400);
	});

	it('offers deep verification as an action the API accepts', async () => {
		// It reaches the domain rather than being rejected by the schema; an
		// unknown discrepancy is then a not-found, not a bad request.
		expect((await fetch('/api/admin/graphics-assets/discrepancies/unknown/actions', {
			method: 'POST',
			headers: { ...administratorHeaders, 'content-type': 'application/json' },
			body: JSON.stringify({ action: 'verify-stored-bytes' }),
		})).status).toBe(404);
	});
});
