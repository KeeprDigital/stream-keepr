import type {
	GraphicAsset,
	GraphicAssetPurgeOutcome,
	GraphicAssetRetentionView,
	GraphicsAssetEvidencePage,
	GraphicsIngestionOperation,
	GraphicsRetentionOverview,
	GraphicsRetentionSweepResult,
} from '~~/shared/types/graphicsAsset';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { $fetch, fetch } from '@nuxt/test-utils/e2e';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '../../shared/types/screenConfig';
import {
	GRAPHICS_EVIDENCE_CATEGORY_GROUP_VALUES,
	GRAPHICS_EVIDENCE_CATEGORY_GROUPS,
} from '../../shared/utils/graphicsAssetEvidence';
import { GRAPHICS_RETENTION_GUARANTEES } from '../../shared/utils/graphicsAssetRetention';
import { createGraphicsAuthorSessionCookie } from './graphicsAuthorSession';
import { INTEGRATION_GRAPHICS_ADMIN_TOKEN } from './helpers';

const transparentPixelPng = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
));
const emptyTextChunk = Uint8Array.of(0, 0, 0, 0, 0x74, 0x45, 0x58, 0x74, 0x96, 0x42, 0xC5, 0x85);

/**
 * Integration suites share one database, and identical bytes deduplicate across
 * Graphic Assets by design. Padding each fixture with a chunk count no other
 * suite uses keeps this suite's content digests to itself.
 */
function pngWithTextChunks(count: number) {
	return Uint8Array.from(Buffer.concat([
		transparentPixelPng.slice(0, -12),
		...Array.from({ length: count }).fill(emptyTextChunk) as Uint8Array[],
		transparentPixelPng.slice(-12),
	]));
}

const retentionPixelPng = pngWithTextChunks(30);
const retentionReplacementPng = pngWithTextChunks(31);
const retentionReferencedPng = pngWithTextChunks(32);

function decodeEvidence(bytes: Uint8Array) {
	return {
		outcome: 'decoded' as const,
		sourceDigest: createHash('sha256').update(bytes).digest('hex'),
		width: 1,
		height: 1,
	};
}

describe('the Graphics Asset Library retention API', () => {
	const administratorHeaders = {
		'x-graphics-admin-token': INTEGRATION_GRAPHICS_ADMIN_TOKEN,
	};
	let authorHeaders: Record<string, string>;

	beforeAll(async () => {
		authorHeaders = {
			'cookie': await createGraphicsAuthorSessionCookie(),
			'x-graphics-author-id': 'retention-integration-author',
		};
	});

	async function ingest(name: string, idempotencyKey: string, bytes = retentionPixelPng) {
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

	async function replace(assetId: string, idempotencyKey: string) {
		const initiated = await $fetch<GraphicsIngestionOperation>(
			`/api/graphics-assets/${assetId}/replacement-operations`,
			{
				method: 'POST',
				headers: authorHeaders,
				body: {
					idempotencyKey,
					sourceFileName: 'replacement.png',
					declaredMime: 'image/png',
					browserDecodeEvidence: decodeEvidence(retentionReplacementPng),
					declaredByteLength: retentionReplacementPng.byteLength,
				},
			},
		);
		return await fetch(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/content`,
			{
				method: 'PUT',
				headers: { ...authorHeaders, 'content-type': 'image/png' },
				body: retentionReplacementPng,
			},
		).then(response => response.json() as Promise<GraphicsIngestionOperation>);
	}

	it('keeps retention deadlines on the administrator surface', async () => {
		const overview = await fetch('/api/admin/graphics-assets/retention');
		expect(overview.status).toBe(403);
		const sweep = await fetch('/api/admin/graphics-assets/retention', { method: 'POST' });
		expect(sweep.status).toBe(403);
		const evidence = await fetch('/api/admin/graphics-assets/evidence');
		expect(evidence.status).toBe(403);
	});

	it('exposes exact recovery and cleanup deadlines without shortening them', async () => {
		const operation = await ingest('Retention deadline logo', 'retention-deadlines');
		const assetId = operation.result!.assetId;
		const replacement = await replace(assetId, 'retention-deadlines-replacement');

		const superseded = await $fetch<GraphicAssetRetentionView>(
			`/api/graphics-assets/${assetId}/retention`,
			{ headers: authorHeaders },
		);
		expect(superseded).toMatchObject({
			assetId,
			lifecycle: { state: 'active' },
			revisions: [
				{
					revisionId: operation.result!.revisionId,
					revisionNumber: 1,
					retention: {
						policy: 'unreferenced-superseded',
						pruneAfter: expect.any(String),
						unreferencedSince: expect.any(String),
					},
				},
				{
					revisionId: replacement.result!.revisionId,
					revisionNumber: 2,
					retention: { policy: 'latest-revision' },
				},
			],
		});
		const supersededRetention = superseded.revisions[0]!.retention;
		if (supersededRetention.policy !== 'unreferenced-superseded')
			throw new Error('Superseded revision should carry a pruning deadline');
		expect(
			new Date(supersededRetention.pruneAfter).getTime()
				- new Date(supersededRetention.unreferencedSince).getTime(),
		).toBe(GRAPHICS_RETENTION_GUARANTEES.supersededRevisionMilliseconds);

		await $fetch(`/api/graphics-assets/${assetId}/lifecycle-actions`, {
			method: 'POST',
			headers: authorHeaders,
			body: { action: 'trash' },
		});
		const trashed = await $fetch<GraphicAssetRetentionView>(
			`/api/graphics-assets/${assetId}/retention`,
			{ headers: authorHeaders },
		);
		if (trashed.lifecycle.state !== 'trashed')
			throw new Error('Graphic Asset should be Trashed');
		expect(
			new Date(trashed.lifecycle.recoverableUntil).getTime()
				- new Date(trashed.lifecycle.trashedAt).getTime(),
		).toBe(GRAPHICS_RETENTION_GUARANTEES.trashRecoveryMilliseconds);
		expect(trashed.revisions[0]!.retention).toMatchObject({ policy: 'pruning-frozen' });

		const overview = await $fetch<GraphicsRetentionOverview>(
			'/api/admin/graphics-assets/retention',
			{ headers: administratorHeaders },
		);
		expect(overview.guarantees).toEqual({ ...GRAPHICS_RETENTION_GUARANTEES });
		expect(overview.guaranteesShortenedUnderPressure).toBe(false);
		expect(overview.trashedAssets).toEqual(expect.arrayContaining([
			expect.objectContaining({
				assetId,
				recoverableUntil: trashed.lifecycle.recoverableUntil,
				referenceCount: 0,
			}),
		]));

		// A sweep at ordinary time reclaims nothing whose window is still open.
		const swept = await $fetch<GraphicsRetentionSweepResult>(
			'/api/admin/graphics-assets/retention',
			{ method: 'POST', headers: administratorHeaders },
		);
		expect(swept.trash.purged).toBe(0);
		expect(swept.revisions.pruned).toBe(0);
		expect(swept.stagedInput).toEqual({
			expiredIncompleteTransfers: 0,
			expiredCompletedInput: 0,
		});
		await expect($fetch<GraphicAssetRetentionView>(
			`/api/graphics-assets/${assetId}/retention`,
			{ headers: authorHeaders },
		)).resolves.toMatchObject({ lifecycle: { state: 'trashed' } });

		// Restore so this asset does not affect the other cases.
		await $fetch(`/api/graphics-assets/${assetId}/lifecycle-actions`, {
			method: 'POST',
			headers: authorHeaders,
			body: { action: 'restore' },
		});
	});

	it('purges confirmed unreferenced Trash early and records auditable Evidence', async () => {
		const operation = await ingest('Early purge logo', 'retention-early-purge');
		const assetId = operation.result!.assetId;

		const unconfirmed = await fetch(`/api/admin/graphics-assets/${assetId}/purge`, {
			method: 'POST',
			headers: { ...administratorHeaders, 'content-type': 'application/json' },
			body: JSON.stringify({ confirmation: 'yes' }),
		});
		expect(unconfirmed.status).toBe(400);

		const active = await fetch(`/api/admin/graphics-assets/${assetId}/purge`, {
			method: 'POST',
			headers: { ...administratorHeaders, 'content-type': 'application/json' },
			body: JSON.stringify({ confirmation: 'purge-now' }),
		});
		expect(active.status).toBe(409);

		await $fetch(`/api/graphics-assets/${assetId}/lifecycle-actions`, {
			method: 'POST',
			headers: authorHeaders,
			body: { action: 'trash' },
		});
		const purged = await $fetch<GraphicAssetPurgeOutcome>(
			`/api/admin/graphics-assets/${assetId}/purge`,
			{
				method: 'POST',
				headers: administratorHeaders,
				body: { confirmation: 'purge-now' },
			},
		);
		expect(purged).toMatchObject({
			outcome: 'purged',
			assetId,
			revisionCount: 1,
			referenceCount: 0,
			reason: 'early-purge',
		});

		await expect($fetch<GraphicAsset[]>('/api/graphics-assets', {
			headers: authorHeaders,
			query: { search: 'Early purge logo', lifecycleStates: 'active,retired,trashed' },
		})).resolves.toEqual([]);
		const restored = await fetch(`/api/graphics-assets/${assetId}/lifecycle-actions`, {
			method: 'POST',
			headers: { ...authorHeaders, 'content-type': 'application/json' },
			body: JSON.stringify({ action: 'restore' }),
		});
		expect(restored.status).toBe(404);

		const evidence = await $fetch<GraphicsAssetEvidencePage>(
			'/api/admin/graphics-assets/evidence',
			{ headers: administratorHeaders, query: { category: 'graphic-asset-purged' } },
		);
		expect(evidence.entries).toEqual(expect.arrayContaining([
			expect.objectContaining({
				category: 'graphic-asset-purged',
				subject: { kind: 'graphic-asset', id: assetId },
				outcome: 'graphic-asset-purged',
				reason: 'early-purge',
			}),
		]));
	});

	it('reads the ledger by group, actor, correlation, and cursor', async () => {
		const page = await $fetch<GraphicsAssetEvidencePage>(
			'/api/admin/graphics-assets/evidence',
			{ headers: administratorHeaders, query: { group: 'lifecycle', limit: 1 } },
		);
		expect(page.entries).toHaveLength(1);
		const entry = page.entries[0]!;
		// A group names a set of categories, so the entry it found is one of them
		// rather than whatever happened to be newest.
		expect(GRAPHICS_EVIDENCE_CATEGORY_GROUPS.lifecycle as readonly string[])
			.toContain(entry.category);
		expect(page.newer).toBeNull();
		expect(page.older).toEqual({ recordedAt: entry.recordedAt, id: entry.id });

		// Turning one page and coming back lands on the entry it started from,
		// which an offset that shifted under a concurrent sweep would not.
		const older = await $fetch<GraphicsAssetEvidencePage>(
			'/api/admin/graphics-assets/evidence',
			{
				headers: administratorHeaders,
				query: {
					group: 'lifecycle',
					limit: 1,
					cursorRecordedAt: page.older!.recordedAt,
					cursorId: page.older!.id,
				},
			},
		);
		expect(older.entries[0]!.id).not.toBe(entry.id);
		const back = await $fetch<GraphicsAssetEvidencePage>(
			'/api/admin/graphics-assets/evidence',
			{
				headers: administratorHeaders,
				query: {
					group: 'lifecycle',
					limit: 1,
					direction: 'newer',
					cursorRecordedAt: older.newer!.recordedAt,
					cursorId: older.newer!.id,
				},
			},
		);
		expect(back.entries[0]!.id).toBe(entry.id);

		await expect($fetch<GraphicsAssetEvidencePage>(
			'/api/admin/graphics-assets/evidence',
			{ headers: administratorHeaders, query: { actor: entry.actor, limit: 5 } },
		)).resolves.toMatchObject({
			entries: expect.arrayContaining([
				expect.objectContaining({ actor: entry.actor }),
			]),
		});
		const correlated = await $fetch<GraphicsAssetEvidencePage>(
			'/api/admin/graphics-assets/evidence',
			{
				headers: administratorHeaders,
				query: { correlationId: entry.correlationId, limit: 50 },
			},
		);
		expect(correlated.entries.length).toBeGreaterThan(0);
		for (const correlatedEntry of correlated.entries)
			expect(correlatedEntry.correlationId).toBe(entry.correlationId);

		// Half a subject filter and half a cursor are both refused, because each
		// would answer a different question from the one that was asked.
		expect((await fetch(
			'/api/admin/graphics-assets/evidence?subjectKind=graphic-asset',
			{ headers: administratorHeaders },
		)).status).toBe(400);
		expect((await fetch(
			'/api/admin/graphics-assets/evidence?cursorId=entry',
			{ headers: administratorHeaders },
		)).status).toBe(400);
		expect((await fetch(
			'/api/admin/graphics-assets/evidence?group=not-a-group',
			{ headers: administratorHeaders },
		)).status).toBe(400);
	});

	it('never stores or displays anything the ledger promised to keep out', async () => {
		// Drive one asset through the transitions that write Evidence, so the
		// negative below is asserted against several category groups rather than
		// against a thin payload that would pass by saying almost nothing. The
		// purge group comes from the early-purge case above, which has already
		// written to the same ledger; purging again here would strand the content
		// of a second asset, and the suites share one database.
		//
		// Quarantine and ingestion expiry are absent on purpose: both need days
		// to elapse, which only the controlled-clock module tests can offer.
		const leakage = await ingest('Leak scan logo', 'retention-leak-scan', pngWithTextChunks(33));
		const leakageAssetId = leakage.result!.assetId;
		await replace(leakageAssetId, 'retention-leak-scan-replacement');
		for (const action of ['retire', 'trash', 'restore'] as const) {
			await $fetch(`/api/graphics-assets/${leakageAssetId}/lifecycle-actions`, {
				method: 'POST',
				headers: authorHeaders,
				body: { action },
			});
		}

		const page = await $fetch<GraphicsAssetEvidencePage>(
			'/api/admin/graphics-assets/evidence',
			{ headers: administratorHeaders, query: { limit: 500 } },
		);
		expect(page.entries.length).toBeGreaterThan(0);
		const covered = new Set(page.entries.flatMap(entry =>
			GRAPHICS_EVIDENCE_CATEGORY_GROUP_VALUES.filter(group =>
				(GRAPHICS_EVIDENCE_CATEGORY_GROUPS[group] as readonly string[])
					.includes(entry.category))));
		for (const group of ['lifecycle', 'pruning', 'purge', 'restoration'] as const)
			expect([...covered], `no Evidence from the ${group} group`).toContain(group);

		const serialised = JSON.stringify(page);
		// Source filenames, raw object keys and canonical prefixes, digests, and
		// delivery or signed URLs. Subjects are opaque domain identities, so none
		// of these has any reason to appear even inside a detail payload.
		for (const forbidden of [
			'logo.png',
			'.png',
			'sha256/',
			'graphics/',
			'staging/',
			'http://',
			'https://',
			'X-Amz-Signature',
			'x-graphics-admin-token',
		])
			expect(serialised, `leaked ${forbidden}`).not.toContain(forbidden);

		// A digest is 64 hex characters; nothing in the ledger may look like one.
		expect(serialised).not.toMatch(/[0-9a-f]{64}/);
		// Nor may anything report bytes that were deleted as recoverable content.
		for (const entry of page.entries) {
			expect(Object.keys(entry.detail)).not.toContain('digest');
			expect(Object.keys(entry.detail)).not.toContain('objectKey');
			expect(Object.keys(entry.detail)).not.toContain('fileName');
			expect(Object.keys(entry.detail)).not.toContain('url');
		}
	});

	it('retains a referenced superseded revision with no deadline and never purges it', async () => {
		const event = await $fetch<{ id: number }>('/api/events', {
			method: 'POST',
			body: {
				name: 'Graphic Asset Retention Event',
				game: 'mtg',
				featureMatchOrientation: 'horizontal',
			},
		});
		try {
			const screen = await $fetch<{ id: number }>(`/api/events/${event.id}/screens`, {
				method: 'POST',
				body: {
					name: 'Retention overlay',
					slug: `retention-overlay-${event.id}`,
					currentMode: 'feature-match-overlay',
				},
			});
			const operation = await ingest(
				'Referenced retention logo',
				'retention-referenced-revision',
				retentionReferencedPng,
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
			await replace(assetId, 'retention-referenced-revision-replacement');

			const view = await $fetch<GraphicAssetRetentionView>(
				`/api/graphics-assets/${assetId}/retention`,
				{ headers: authorHeaders },
			);
			expect(view.revisions[0]).toMatchObject({
				revisionId: operation.result!.revisionId,
				retention: { policy: 'referenced', referenceCount: 1 },
			});

			const swept = await $fetch<GraphicsRetentionSweepResult>(
				'/api/admin/graphics-assets/retention',
				{ method: 'POST', headers: administratorHeaders },
			);
			expect(swept.revisions.pruned).toBe(0);
			const trash = await fetch(`/api/graphics-assets/${assetId}/lifecycle-actions`, {
				method: 'POST',
				headers: { ...authorHeaders, 'content-type': 'application/json' },
				body: JSON.stringify({ action: 'trash' }),
			});
			await expect(trash.json()).resolves.toMatchObject({ outcome: 'in-use' });
		}
		finally {
			await $fetch(`/api/events/${event.id}`, { method: 'DELETE' }).catch(() => {});
		}
	});
});
