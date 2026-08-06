import type { SilentVideoPlaybackValidator } from '~~/server/modules/graphics-asset-library/silent-video-playback-validator';
import type {
	GraphicAssetId,
	GraphicAssetRevisionId,
	GraphicsDiscrepancy,
	GraphicsIngestionOperation,
} from '~~/shared/types/graphicsAsset';
import type { SqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGraphicsAssetLibrary } from '~~/server/modules/graphics-asset-library';
import { createD1GraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library/catalogue';
import {
	createInMemoryCanonicalGraphicsObjectStore,
	createInMemoryStagingGraphicsObjectStore,
} from '~~/server/modules/graphics-asset-library/in-memory-object-store';
import {
	createBoundedByteStream,
	graphicsObjectIdentity,
} from '~~/server/modules/graphics-asset-library/object-store';
import { evidenceOf } from '~~/test/helpers/graphicsEvidence';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

const pixelPng = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
));
const emptyTextChunk = Uint8Array.of(0, 0, 0, 0, 0x74, 0x45, 0x58, 0x74, 0x96, 0x42, 0xC5, 0x85);
const otherPng = Uint8Array.of(
	...pixelPng.slice(0, -12),
	...emptyTextChunk,
	...pixelPng.slice(-12),
);

const vp9Webm = Uint8Array.from(Buffer.from(
	'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAIMEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggElTbuMU6uEHFO7a1OsggH27AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjIuMTIuMTAyV0GNTGF2ZjYyLjEyLjEwMkSJiECPQAAAAAAAFlSua8iuAQAAAAAAAD/XgQFzxYhkRqj8GKbqBJyBACK1nIN1bmSIgQCGhVZfVlA5g4EBI+ODhB3NZQDgkLCBELqBEJqBAlWwhFW5gQESVMNnQIBzc6BjwIBnyJpFo4dFTkNPREVSRIeNTGF2ZjYyLjEyLjEwMnNz2mPAi2PFiGRGqPwYpuoEZ8ilRaOHRU5DT0RFUkSHmExhdmM2Mi4yOC4xMDIgbGlidnB4LXZwOWfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDEuMDAwMDAwMDAwAB9DtnXG54EAo6yBAACAgkmDQgAA8AD2ADgkHBhCAAAwcAAASqf/+5CBv///CAg////7iYcAAKOTgQH0AIYAQJKcAElAAAMgAABCQBxTu2uRu4+zgQC3iveBAfGCAavwgQM=',
	'base64',
));

const sixteenPixelPosterPng = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAHUlEQVR4nGP8x8Dwn4ECwEKJ5lEDRg0YNWAwGQAAkU4CO63xbeIAAAAASUVORK5CYII=',
	'base64',
));

const DAY = 24 * 60 * 60 * 1000;

function digestOf(bytes: Uint8Array) {
	return createHash('sha256').update(bytes).digest('hex');
}

function canonicalIdentity(digest: string) {
	return graphicsObjectIdentity(`sha256/${digest}`);
}

/**
 * Exactly what publication writes alongside canonical bytes: the media type and
 * the digest that owns the key, repeated as redundant integrity metadata.
 */
function canonicalMetadata(digest: string) {
	return { contentType: 'image/png', custom: { sha256: digest } };
}

function decodeEvidence(bytes: Uint8Array) {
	return {
		outcome: 'decoded' as const,
		sourceDigest: digestOf(bytes),
		width: 1,
		height: 1,
	};
}

function boundedBytes(bytes: Uint8Array) {
	return createBoundedByteStream(bytes, {
		byteLength: bytes.byteLength,
		maximumByteLength: bytes.byteLength,
	});
}

/**
 * The pinned silent-video validation runtime as a controlled adapter, exactly
 * as the ingestion suites drive it. Regeneration must reach it the same way
 * ingestion does, so this double also proves the staged working copy is where
 * the runtime expects to find its source.
 */
function acceptEverySilentVideo(): SilentVideoPlaybackValidator & { stagedSources: string[] } {
	const stagedSources: string[] = [];
	return {
		stagedSources,
		validate: async (input) => {
			stagedSources.push(`ingestion/${input.operationId}/source`);
			return {
				outcome: 'accepted' as const,
				operationId: input.operationId,
				idempotencyKey: input.idempotencyKey,
				sourceDigest: input.sourceDigest,
				factsDigest: input.factsDigest,
				width: input.inspectedFacts.width,
				height: input.inspectedFacts.height,
				durationSeconds: input.inspectedFacts.durationSeconds,
				posterTimeSeconds: input.inspectedFacts.posterTimeSeconds,
				mutedInlinePlayback: true as const,
				seeked: true as const,
				transparencyRendered: false,
				posterDigest: digestOf(sixteenPixelPosterPng),
				poster: boundedBytes(sixteenPixelPosterPng),
			};
		},
	};
}

let harness: SqliteD1Harness;

function createReconciliationLibrary(
	dependencies: Partial<Parameters<typeof createGraphicsAssetLibrary>[0]> = {},
) {
	let currentTime = new Date('2026-07-30T00:00:00.000Z');
	let nextIdentity = 0;
	const staging = createInMemoryStagingGraphicsObjectStore();
	const canonical = createInMemoryCanonicalGraphicsObjectStore();
	const library = createGraphicsAssetLibrary({
		catalogue: createD1GraphicsAssetCatalogue(harness.database),
		staging,
		canonical,
		now: () => currentTime,
		generateIdentity: () => `reconciliation-${++nextIdentity}`,
		...dependencies,
	});
	return {
		library,
		staging,
		canonical,
		advance(milliseconds: number) {
			currentTime = new Date(currentTime.getTime() + milliseconds);
		},
	};
}

type ReconciliationLibrary = ReturnType<typeof createReconciliationLibrary>;

async function ingestImage(
	context: ReconciliationLibrary,
	options: { idempotencyKey: string; name: string; bytes?: Uint8Array },
): Promise<GraphicsIngestionOperation> {
	const bytes = options.bytes ?? pixelPng;
	const operation = await context.library.initiateGraphicsIngestion({
		idempotencyKey: options.idempotencyKey,
		initiatedBy: 'reconciliation-author',
		name: options.name,
		sourceFileName: 'logo.png',
		declaredMime: 'image/png',
		browserDecodeEvidence: decodeEvidence(bytes),
		declaredByteLength: bytes.byteLength,
		duplicateContentPolicy: 'create-separate',
	});
	context.advance(1000);
	return await context.library.uploadGraphicAsset({
		operationId: operation.id,
		initiatedBy: operation.initiatedBy,
		declaredMime: 'image/png',
		bytes: boundedBytes(bytes),
	});
}

function publishedReference(operation: GraphicsIngestionOperation) {
	const result = operation.result;
	if (!result)
		throw new Error('The ingestion operation did not publish a Graphic Asset');
	return { assetId: result.assetId, revisionId: result.revisionId };
}

/**
 * References belong to graphics artifacts, not to the library, so tests create
 * them exactly as a Screen reference writer does and then observe what
 * reconciliation does — and does not do — to them.
 */
async function addReference(input: {
	referenceId: string;
	assetId: GraphicAssetId;
	revisionId: GraphicAssetRevisionId;
}) {
	await harness.client.execute({
		sql: `
			INSERT INTO graphic_asset_references (
				id, asset_id, revision_id, owner_kind, owner_id, owner_slot,
				event_id, created_at, updated_at
			) VALUES (?, ?, ?, 'screen', '1', ?, NULL, 0, 0)
		`,
		args: [input.referenceId, input.assetId, input.revisionId, input.referenceId],
	});
}

/** The digest of the deterministic thumbnail generated for one revision. */
async function thumbnailDigest(revisionId: GraphicAssetRevisionId) {
	const result = await harness.client.execute({
		sql: 'SELECT content_digest FROM graphics_derivatives WHERE source_revision_id = ?',
		args: [revisionId],
	});
	const digest = result.rows[0]?.content_digest;
	if (typeof digest !== 'string')
		throw new Error('The revision has no Graphics Derivative');
	return digest;
}

async function contentAvailability(digest: string) {
	const result = await harness.client.execute({
		sql: 'SELECT availability, unavailable_reason_code FROM graphic_asset_contents WHERE digest = ?',
		args: [digest],
	});
	return result.rows[0] as { availability: string; unavailable_reason_code: string | null } | undefined;
}

function openDiscrepancy(
	discrepancies: readonly GraphicsDiscrepancy[],
	kind: GraphicsDiscrepancy['kind'],
) {
	const found = discrepancies.find(discrepancy => discrepancy.kind === kind);
	if (!found)
		throw new Error(`No open ${kind} discrepancy was recorded`);
	return found;
}

beforeEach(async () => {
	harness = await createSqliteD1Harness();
});

afterEach(async () => {
	await harness.close();
});

describe('graphics asset reconciliation', () => {
	describe('missing expected objects', () => {
		it('marks content unavailable while every identity and reference stays intact', async () => {
			const context = createReconciliationLibrary();
			const operation = await ingestImage(context, {
				idempotencyKey: 'missing-object',
				name: 'Missing bytes',
			});
			const reference = publishedReference(operation);
			await addReference({ referenceId: 'screen-slot', ...reference });

			await context.canonical.delete(canonicalIdentity(digestOf(pixelPng)));
			const sweep = await context.library.runGraphicsReconciliation();

			expect(sweep.content.unavailableDetected).toBe(1);
			expect((await contentAvailability(digestOf(pixelPng)))?.availability).toBe('unavailable');

			// The identity, its revision, and its pinned usage are untouched.
			const assets = await context.library.listGraphicAssets({});
			expect(assets.map(asset => asset.id)).toContain(reference.assetId);
			const usage = await context.library.listGraphicAssetUsage({ assetId: reference.assetId });
			expect(usage).toHaveLength(1);
			expect(usage[0]?.reference).toEqual(reference);

			// The revision resolves as retryably unavailable, never as missing.
			expect(await context.library.inspectGraphicAssetRevision(reference))
				.toEqual({ outcome: 'unavailable', retryable: true });
		});

		it('keeps one persistent alert rather than a new incident every pass', async () => {
			const context = createReconciliationLibrary();
			await ingestImage(context, { idempotencyKey: 'persistent', name: 'Persistent alert' });
			await context.canonical.delete(canonicalIdentity(digestOf(pixelPng)));

			await context.library.runGraphicsReconciliation();
			const first = await context.library.getReconciliationOverview();
			context.advance(DAY);
			const second = await context.library.runGraphicsReconciliation();
			const after = await context.library.getReconciliationOverview();

			expect(after.openCounts['unavailable-content']).toBe(1);
			expect(after.discrepancies.filter(entry => entry.kind === 'unavailable-content'))
				.toHaveLength(1);
			// The incident keeps its original detection instant and gains a fresh
			// observation, so its age is real.
			const [before] = first.discrepancies.filter(entry => entry.kind === 'unavailable-content');
			const [now] = after.discrepancies.filter(entry => entry.kind === 'unavailable-content');
			expect(now?.detectedAt).toBe(before?.detectedAt);
			expect(now?.lastCheckedAt).not.toBe(before?.lastCheckedAt);
			expect(second.evidence.recorded).toBe(0);
		});

		it('clears the alert once the byte store agrees again', async () => {
			const context = createReconciliationLibrary();
			await ingestImage(context, { idempotencyKey: 'recovered', name: 'Recovered bytes' });
			const identity = canonicalIdentity(digestOf(pixelPng));
			await context.canonical.delete(identity);
			await context.library.runGraphicsReconciliation();

			await context.canonical.createImmutable({
				identity,
				bytes: boundedBytes(pixelPng),
				metadata: canonicalMetadata(digestOf(pixelPng)),
			});
			context.advance(1000);
			const sweep = await context.library.runGraphicsReconciliation();

			expect(sweep.content.availabilityRestored).toBe(1);
			expect((await contentAvailability(digestOf(pixelPng)))?.availability).toBe('available');
			const overview = await context.library.getReconciliationOverview();
			expect(overview.openCounts['unavailable-content']).toBe(0);
		});

		it('leaves healthy content alone when the byte store cannot answer', async () => {
			const context = createReconciliationLibrary();
			await ingestImage(context, { idempotencyKey: 'transient', name: 'Transient failure' });
			context.canonical.injectTransientFailure('metadata', 10);

			const sweep = await context.library.runGraphicsReconciliation();

			expect(sweep.content.checked).toBe(0);
			expect(sweep.content.unavailableDetected).toBe(0);
			expect((await contentAvailability(digestOf(pixelPng)))?.availability).toBe('available');
		});
	});

	describe('reconciliation triggered by an observed integrity failure', () => {
		it('records the incident from a reader without waiting for the schedule', async () => {
			const context = createReconciliationLibrary();
			const operation = await ingestImage(context, {
				idempotencyKey: 'observed',
				name: 'Observed failure',
			});
			const reference = publishedReference(operation);
			await context.canonical.delete(canonicalIdentity(digestOf(pixelPng)));

			const resolution = await context.library.resolveGraphicAssetRevision(reference);
			expect(resolution).toEqual({ outcome: 'unavailable', retryable: true });

			// No sweep has run, yet the disagreement is already durable.
			const overview = await context.library.getReconciliationOverview();
			expect(overview.openCounts['unavailable-content']).toBe(1);
			expect((await contentAvailability(digestOf(pixelPng)))?.availability).toBe('unavailable');
		});

		it('keeps repeated delivery reads out of the ledger after the first', async () => {
			const context = createReconciliationLibrary();
			const operation = await ingestImage(context, {
				idempotencyKey: 'high-volume-delivery',
				name: 'Repeatedly delivered',
			});
			const reference = publishedReference(operation);
			await context.canonical.delete(canonicalIdentity(digestOf(pixelPng)));

			// Delivery is the highest-volume path the library has. A per-request
			// audit row would put the ledger's growth in the hands of whoever is
			// watching the stream, so the incident is announced once and every
			// later read re-observes the discrepancy already open.
			for (let read = 0; read < 25; read++)
				await context.library.resolveGraphicAssetRevision(reference);

			const overview = await context.library.getReconciliationOverview();
			expect(overview.openCounts['unavailable-content']).toBe(1);
			const entries = await evidenceOf(context.library, {
				categories: ['content-unavailable-detected'],
				limit: 500,
			});
			expect(entries).toHaveLength(1);
			// Nothing about an individual read reaches the ledger either.
			expect(entries[0]!.subject.kind).toBe('graphics-discrepancy');
		});

		it('does not record an incident when the byte store merely could not answer', async () => {
			const context = createReconciliationLibrary();
			const operation = await ingestImage(context, {
				idempotencyKey: 'transient-read',
				name: 'Transient read',
			});
			context.canonical.injectTransientFailure('read', 1);

			await context.library.resolveGraphicAssetRevision(publishedReference(operation));

			const overview = await context.library.getReconciliationOverview();
			expect(overview.openCounts['unavailable-content']).toBe(0);
			expect((await contentAvailability(digestOf(pixelPng)))?.availability).toBe('available');
		});
	});

	describe('exact-byte repair', () => {
		it('restores content from exact bytes without creating a revision or changing a reference', async () => {
			const context = createReconciliationLibrary();
			const operation = await ingestImage(context, {
				idempotencyKey: 'repairable',
				name: 'Repairable',
			});
			const reference = publishedReference(operation);
			await addReference({ referenceId: 'repair-slot', ...reference });
			await context.canonical.delete(canonicalIdentity(digestOf(pixelPng)));
			await context.library.runGraphicsReconciliation();

			const overview = await context.library.getReconciliationOverview();
			const discrepancy = openDiscrepancy(overview.discrepancies, 'unavailable-content');
			expect(discrepancy.actions).toContain('repair-with-exact-bytes');
			expect(discrepancy.affectedUsage[0]?.referenceCount).toBe(1);

			const outcome = await context.library.repairUnavailableGraphicAssetContent({
				discrepancyId: discrepancy.id,
				actor: 'administrator',
				bytes: boundedBytes(pixelPng),
			});

			expect(outcome.outcome).toBe('resolved');
			expect((await contentAvailability(digestOf(pixelPng)))?.availability).toBe('available');
			expect(await context.library.inspectGraphicAssetRevision(reference))
				.toMatchObject({ outcome: 'available' });

			// No revision was created and the pinned reference still points where it did.
			const asset = (await context.library.listGraphicAssets({}))
				.find(entry => entry.id === reference.assetId);
			expect(asset?.revisions).toHaveLength(1);
			const usage = await context.library.listGraphicAssetUsage({ assetId: reference.assetId });
			expect(usage[0]?.reference).toEqual(reference);
		});

		it('refuses bytes that do not hash to the exact expected content', async () => {
			const context = createReconciliationLibrary();
			await ingestImage(context, { idempotencyKey: 'wrong-bytes', name: 'Wrong bytes' });
			await context.canonical.delete(canonicalIdentity(digestOf(pixelPng)));
			await context.library.runGraphicsReconciliation();
			const overview = await context.library.getReconciliationOverview();
			const discrepancy = openDiscrepancy(overview.discrepancies, 'unavailable-content');

			const outcome = await context.library.repairUnavailableGraphicAssetContent({
				discrepancyId: discrepancy.id,
				actor: 'administrator',
				bytes: boundedBytes(otherPng),
			});

			expect(outcome).toMatchObject({ outcome: 'rejected' });
			expect((await contentAvailability(digestOf(pixelPng)))?.availability).toBe('unavailable');
			// Nothing was written under the expected identity.
			expect(await context.canonical.readMetadata(canonicalIdentity(digestOf(pixelPng))))
				.toEqual({ outcome: 'missing' });
		});
	});

	describe('critical integrity incidents', () => {
		it('isolates an object whose recorded facts contradict the catalogue', async () => {
			const context = createReconciliationLibrary();
			await ingestImage(context, { idempotencyKey: 'conflicted', name: 'Conflicted' });
			const identity = canonicalIdentity(digestOf(pixelPng));
			await context.canonical.delete(identity);
			await context.canonical.createImmutable({
				identity,
				bytes: boundedBytes(pixelPng),
				metadata: { contentType: 'image/jpeg' },
			});

			const sweep = await context.library.runGraphicsReconciliation();

			expect(sweep.criticalIntegrityIncidents).toBe(1);
			const overview = await context.library.getReconciliationOverview();
			const incident = openDiscrepancy(overview.discrepancies, 'critical-integrity-incident');
			expect(incident.isolated).toBe(true);
			expect(incident.reasonCode).toBe('canonical-object-facts-mismatch');
			// Nothing that writes is on offer. Deep verification is, because it is
			// the only action that can settle the conflict without overwriting.
			expect(incident.actions).toEqual(['recheck', 'verify-stored-bytes']);
			expect((await contentAvailability(digestOf(pixelPng)))?.availability).toBe('unavailable');
		});

		it('isolates an object that lost the redundant digest metadata it was written with', async () => {
			const context = createReconciliationLibrary();
			await ingestImage(context, { idempotencyKey: 'metadata', name: 'Lost metadata' });
			const identity = canonicalIdentity(digestOf(pixelPng));
			await context.canonical.delete(identity);
			// The right bytes, size, and media type, but no proof of which digest
			// owns the key. Publication refuses to reuse such an object, so
			// reconciliation must not report it as agreement either.
			await context.canonical.createImmutable({
				identity,
				bytes: boundedBytes(pixelPng),
				metadata: { contentType: 'image/png' },
			});

			const sweep = await context.library.runGraphicsReconciliation();

			expect(sweep.criticalIntegrityIncidents).toBe(1);
			const overview = await context.library.getReconciliationOverview();
			const incident = openDiscrepancy(overview.discrepancies, 'critical-integrity-incident');
			expect(incident.reasonCode).toBe('canonical-object-redundant-metadata-mismatch');
			expect(incident.isolated).toBe(true);
			expect(incident.actions).toEqual(['recheck', 'verify-stored-bytes']);
		});

		it('never repairs an isolated incident by overwriting bytes', async () => {
			const context = createReconciliationLibrary();
			await ingestImage(context, { idempotencyKey: 'no-overwrite', name: 'No overwrite' });
			const identity = canonicalIdentity(digestOf(pixelPng));
			await context.canonical.delete(identity);
			await context.canonical.createImmutable({
				identity,
				bytes: boundedBytes(pixelPng),
				metadata: { contentType: 'image/jpeg' },
			});
			await context.library.runGraphicsReconciliation();
			const overview = await context.library.getReconciliationOverview();
			const incident = openDiscrepancy(overview.discrepancies, 'critical-integrity-incident');

			const outcome = await context.library.repairUnavailableGraphicAssetContent({
				discrepancyId: incident.id,
				actor: 'administrator',
				bytes: boundedBytes(pixelPng),
			});

			expect(outcome).toMatchObject({
				outcome: 'rejected',
				code: 'integrity-incident-isolated',
			});
			// The stored object was left exactly as it was found.
			const stored = await context.canonical.readMetadata(identity);
			expect(stored).toMatchObject({ outcome: 'available' });
			expect(stored.outcome === 'available' && stored.object.contentType).toBe('image/jpeg');
			expect((await contentAvailability(digestOf(pixelPng)))?.availability).toBe('unavailable');
		});
	});

	describe('unexpected canonical objects', () => {
		it('quarantines them, never adopts them, and deletes only after the recheck window', async () => {
			const context = createReconciliationLibrary();
			await ingestImage(context, { idempotencyKey: 'expected', name: 'Expected' });
			const strayDigest = digestOf(otherPng);
			await context.canonical.createImmutable({
				identity: canonicalIdentity(strayDigest),
				bytes: boundedBytes(otherPng),
				metadata: canonicalMetadata(strayDigest),
			});

			const sweep = await context.library.runGraphicsReconciliation();
			expect(sweep.unexpectedObjects.quarantined).toBe(1);

			// Nothing was adopted: no asset, revision, or content row was invented.
			const assets = await context.library.listGraphicAssets({});
			expect(assets).toHaveLength(1);
			const contents = await harness.client.execute(
				'SELECT digest FROM graphic_asset_contents',
			);
			expect(contents.rows.map(row => row.digest)).not.toContain(strayDigest);

			const overview = await context.library.getReconciliationOverview();
			const discrepancy = openDiscrepancy(overview.discrepancies, 'unexpected-object');
			expect(discrepancy.actions).toEqual(['recheck']);
			expect(discrepancy.quarantine?.deleteAfter).toBeDefined();

			// Before the window elapses the retention sweep leaves the bytes alone.
			context.advance(6 * DAY);
			await context.library.runGraphicsRetention();
			expect(await context.canonical.readMetadata(canonicalIdentity(strayDigest)))
				.toMatchObject({ outcome: 'available' });

			context.advance(2 * DAY);
			const retention = await context.library.runGraphicsRetention();
			expect(retention.content.deleted).toBe(1);
			expect(await context.canonical.readMetadata(canonicalIdentity(strayDigest)))
				.toEqual({ outcome: 'missing' });

			// The incident closes itself once the bytes it was about are gone.
			await context.library.runGraphicsReconciliation();
			expect((await context.library.getReconciliationOverview())
				.openCounts['unexpected-object']).toBe(0);
		});

		it('keeps quarantined bytes the catalogue has since started to expect', async () => {
			const context = createReconciliationLibrary();
			await context.canonical.createImmutable({
				identity: canonicalIdentity(digestOf(pixelPng)),
				bytes: boundedBytes(pixelPng),
				metadata: canonicalMetadata(digestOf(pixelPng)),
			});
			await context.library.runGraphicsReconciliation();
			expect((await context.library.getReconciliationOverview())
				.openCounts['unexpected-object']).toBe(1);

			// An ordinary ingestion of identical bytes makes them expected. The
			// bytes are reused rather than adopted: the asset is published by that
			// operation, not invented from the stray object.
			await ingestImage(context, { idempotencyKey: 'now-expected', name: 'Now expected' });

			context.advance(8 * DAY);
			const retention = await context.library.runGraphicsRetention();
			expect(retention.content.deleted).toBe(0);

			// The stale incident closes on its own once the catalogue agrees.
			const sweep = await context.library.runGraphicsReconciliation();
			expect(sweep.evidence.recorded).toBeGreaterThan(0);
			expect((await context.library.getReconciliationOverview())
				.openCounts['unexpected-object']).toBe(0);
			expect(await context.canonical.readMetadata(canonicalIdentity(digestOf(pixelPng))))
				.toMatchObject({ outcome: 'available' });
		});

		it('isolates an object whose key is not a digest-owned identity', async () => {
			const context = createReconciliationLibrary();
			await context.canonical.createImmutable({
				identity: graphicsObjectIdentity('not-a-digest/strays-here'),
				bytes: boundedBytes(pixelPng),
				metadata: canonicalMetadata(digestOf(pixelPng)),
			});

			const sweep = await context.library.runGraphicsReconciliation();

			expect(sweep.criticalIntegrityIncidents).toBe(1);
			expect(sweep.unexpectedObjects.quarantined).toBe(0);
			const overview = await context.library.getReconciliationOverview();
			const incident = openDiscrepancy(overview.discrepancies, 'critical-integrity-incident');
			expect(incident.reasonCode).toBe('foreign-canonical-object');
			expect(incident.isolated).toBe(true);

			// It is held, never deleted on a guess.
			context.advance(30 * DAY);
			await context.library.runGraphicsRetention();
			expect(await context.canonical.readMetadata(
				graphicsObjectIdentity('not-a-digest/strays-here'),
			)).toMatchObject({ outcome: 'available' });
		});
	});

	describe('deep verification of stored bytes', () => {
		it('closes an incident once the exact bytes are provably back', async () => {
			const context = createReconciliationLibrary();
			const operation = await ingestImage(context, {
				idempotencyKey: 'deep-verify',
				name: 'Deep verify',
			});
			const reference = publishedReference(operation);
			const identity = canonicalIdentity(digestOf(pixelPng));
			await context.canonical.delete(identity);
			await context.library.runGraphicsReconciliation();

			// The bytes come back exactly as publication wrote them.
			await context.canonical.createImmutable({
				identity,
				bytes: boundedBytes(pixelPng),
				metadata: canonicalMetadata(digestOf(pixelPng)),
			});

			const overview = await context.library.getReconciliationOverview();
			const discrepancy = openDiscrepancy(overview.discrepancies, 'unavailable-content');
			const outcome = await context.library.verifyStoredGraphicAssetContent({
				discrepancyId: discrepancy.id,
				actor: 'administrator',
			});

			expect(outcome).toMatchObject({ outcome: 'resolved' });
			expect((await contentAvailability(digestOf(pixelPng)))?.availability).toBe('available');
			expect(await context.library.inspectGraphicAssetRevision(reference))
				.toMatchObject({ outcome: 'available' });
		});

		it('detects bytes that changed behind metadata that still agrees', async () => {
			const context = createReconciliationLibrary();
			await ingestImage(context, { idempotencyKey: 'silent-corruption', name: 'Silent corruption' });
			const identity = canonicalIdentity(digestOf(pixelPng));
			await context.canonical.delete(identity);
			await context.library.runGraphicsReconciliation();

			// Same length, same media type, same recorded digest metadata — only the
			// bytes differ. Nothing short of a full re-hash can tell.
			const corrupted = Uint8Array.from(pixelPng);
			corrupted[corrupted.length - 20] = corrupted[corrupted.length - 20]! ^ 0xFF;
			await context.canonical.createImmutable({
				identity,
				bytes: boundedBytes(corrupted),
				metadata: canonicalMetadata(digestOf(pixelPng)),
			});

			// The open incident still says the bytes were missing, and a head
			// request cannot tell that what came back is not what left.
			const target = openDiscrepancy(
				(await context.library.getReconciliationOverview()).discrepancies,
				'unavailable-content',
			);
			expect(target.actions).toContain('verify-stored-bytes');

			// Deep verification is the only thing that finds it.
			const outcome = await context.library.verifyStoredGraphicAssetContent({
				discrepancyId: target.id,
				actor: 'administrator',
			});

			expect(outcome).toMatchObject({ outcome: 'rejected', code: 'digest-mismatch' });
			const after = await context.library.getReconciliationOverview();
			const incident = openDiscrepancy(after.discrepancies, 'critical-integrity-incident');
			expect(incident.reasonCode).toBe('canonical-object-digest-mismatch');
			expect(incident.isolated).toBe(true);
			// The conflicting bytes were left exactly where they were.
			expect(await context.canonical.readMetadata(identity)).toMatchObject({ outcome: 'available' });
		});

		it('gives an isolated incident a genuine closing action', async () => {
			const context = createReconciliationLibrary();
			await ingestImage(context, { idempotencyKey: 'closeable', name: 'Closeable incident' });
			const identity = canonicalIdentity(digestOf(pixelPng));
			await context.canonical.delete(identity);
			// Stored with the wrong media type: the sweep isolates it.
			await context.canonical.createImmutable({
				identity,
				bytes: boundedBytes(pixelPng),
				metadata: { contentType: 'image/jpeg', custom: { sha256: digestOf(pixelPng) } },
			});
			await context.library.runGraphicsReconciliation();
			const isolated = openDiscrepancy(
				(await context.library.getReconciliationOverview()).discrepancies,
				'critical-integrity-incident',
			);
			expect(isolated.actions).toContain('verify-stored-bytes');

			// An operator repairs the object metadata out of band.
			await context.canonical.delete(identity);
			await context.canonical.createImmutable({
				identity,
				bytes: boundedBytes(pixelPng),
				metadata: canonicalMetadata(digestOf(pixelPng)),
			});

			const outcome = await context.library.verifyStoredGraphicAssetContent({
				discrepancyId: isolated.id,
				actor: 'administrator',
			});

			expect(outcome).toMatchObject({ outcome: 'resolved' });
			expect((await context.library.getReconciliationOverview())
				.openCounts['critical-integrity-incident']).toBe(0);
			expect((await contentAvailability(digestOf(pixelPng)))?.availability).toBe('available');
		});

		it('restores verified bytes a quarantine record was holding', async () => {
			const context = createReconciliationLibrary();
			await ingestImage(context, {
				idempotencyKey: 'quarantine-restore',
				name: 'Quarantine restore',
			});
			const identity = canonicalIdentity(digestOf(pixelPng));
			await context.canonical.delete(identity);
			await context.library.runGraphicsReconciliation();
			await context.canonical.createImmutable({
				identity,
				bytes: boundedBytes(pixelPng),
				metadata: canonicalMetadata(digestOf(pixelPng)),
			});
			// The retention path records quarantine exactly like this when content
			// loses its final reachability; arranging the row directly is the same
			// kind of arrange as writing a reference by hand.
			await harness.client.execute({
				sql: `
					INSERT INTO graphics_content_quarantine (
						id, digest, byte_length, origin, quarantined_at, delete_after, created_at
					) VALUES ('quarantined-copy', ?, ?, 'orphaned-content', 0, ?, 0)
				`,
				args: [digestOf(pixelPng), pixelPng.byteLength, Date.now() + 7 * DAY],
			});

			const discrepancy = openDiscrepancy(
				(await context.library.getReconciliationOverview()).discrepancies,
				'unavailable-content',
			);
			const outcome = await context.library.verifyStoredGraphicAssetContent({
				discrepancyId: discrepancy.id,
				actor: 'administrator',
			});

			expect(outcome).toMatchObject({
				outcome: 'resolved',
				resolution: 'restored-from-quarantine',
			});
			const quarantine = await harness.client.execute(
				'SELECT digest FROM graphics_content_quarantine',
			);
			expect(quarantine.rows).toHaveLength(0);
		});
	});

	describe('derivative regeneration', () => {
		it('regenerates a missing thumbnail from canonical source without touching its revision', async () => {
			const context = createReconciliationLibrary();
			const operation = await ingestImage(context, {
				idempotencyKey: 'derivative',
				name: 'Missing thumbnail',
			});
			const reference = publishedReference(operation);
			const derivativeDigest = await thumbnailDigest(reference.revisionId);
			await context.canonical.delete(canonicalIdentity(derivativeDigest));

			const sweep = await context.library.runGraphicsReconciliation();
			expect(sweep.derivatives.missingDetected).toBe(1);

			const overview = await context.library.getReconciliationOverview();
			const discrepancy = openDiscrepancy(overview.discrepancies, 'missing-derivative');
			expect(discrepancy.actions).toContain('regenerate-derivative');
			expect(discrepancy.derivative?.sourceRevisionId).toBe(reference.revisionId);
			expect(discrepancy.derivative?.sourceAvailable).toBe(true);

			const outcome = await context.library.regenerateGraphicsDerivative({
				discrepancyId: discrepancy.id,
				actor: 'administrator',
			});

			expect(outcome).toMatchObject({
				outcome: 'resolved',
				resolution: 'derivative-regenerated',
			});
			expect(await context.library.resolveGraphicAssetThumbnail({ assetId: reference.assetId }))
				.toMatchObject({ outcome: 'available', contentType: 'image/png' });
			// The source revision is unchanged and no new revision appeared.
			const asset = (await context.library.listGraphicAssets({}))
				.find(entry => entry.id === reference.assetId);
			expect(asset?.revisions).toHaveLength(1);
			expect(asset?.revisionId).toBe(reference.revisionId);
			expect(await thumbnailDigest(reference.revisionId)).toBe(derivativeDigest);

			// A recovery is the one reconciliation action that puts bytes back, so
			// its Evidence records the transition it made and the capacity those
			// bytes landed in.
			await expect(evidenceOf(context.library, {
				categories: ['derivative-regenerated'],
			})).resolves.toEqual([
				expect.objectContaining({
					actor: 'administrator',
					detail: expect.objectContaining({
						transition: { from: 'open', to: 'resolved' },
						canonicalPressure: expect.any(String),
						canonicalUsedBytes: expect.any(Number),
						canonicalLimitBytes: expect.any(Number),
					}),
				}),
			]);
		});

		it('regenerates a silent-video poster through the pinned validation runtime', async () => {
			const validator = acceptEverySilentVideo();
			const context = createReconciliationLibrary({
				silentVideoPlaybackValidator: validator,
			});
			const operation = await context.library.initiateGraphicsIngestion({
				idempotencyKey: 'video-poster',
				initiatedBy: 'reconciliation-author',
				name: 'Sting',
				sourceFileName: 'sting.webm',
				declaredMime: 'video/webm',
				duplicateContentPolicy: 'create-separate',
				declaredByteLength: vp9Webm.byteLength,
			});
			const published = await context.library.uploadGraphicAsset({
				operationId: operation.id,
				initiatedBy: operation.initiatedBy,
				declaredMime: 'video/webm',
				bytes: boundedBytes(vp9Webm),
			});
			const reference = publishedReference(published);
			const posterDigest = await thumbnailDigest(reference.revisionId);
			await context.canonical.delete(canonicalIdentity(posterDigest));
			await context.library.runGraphicsReconciliation();

			const overview = await context.library.getReconciliationOverview();
			const discrepancy = openDiscrepancy(overview.discrepancies, 'missing-derivative');
			expect(discrepancy.derivative?.kind).toBe('video-poster');
			expect(discrepancy.actions).toContain('regenerate-derivative');

			const outcome = await context.library.regenerateGraphicsDerivative({
				discrepancyId: discrepancy.id,
				actor: 'administrator',
			});

			expect(outcome).toMatchObject({
				outcome: 'resolved',
				resolution: 'derivative-regenerated',
			});
			// Regeneration reproduced the exact recorded bytes, so the catalogue's
			// derivative row never needed to change.
			expect(await thumbnailDigest(reference.revisionId)).toBe(posterDigest);
			expect(await context.library.resolveGraphicAssetThumbnail({ assetId: reference.assetId }))
				.toMatchObject({ outcome: 'available' });

			// The runtime read a staged working copy, and it was cleaned up after.
			const regenerationSource = validator.stagedSources.at(-1)!;
			expect(regenerationSource).toContain(`reconciliation-${discrepancy.id}`);
			expect(await context.staging.readMetadata(graphicsObjectIdentity(regenerationSource)))
				.toEqual({ outcome: 'missing' });
		});

		it('refuses to regenerate while the canonical source is unavailable', async () => {
			const context = createReconciliationLibrary();
			const operation = await ingestImage(context, {
				idempotencyKey: 'no-source',
				name: 'No source',
			});
			const reference = publishedReference(operation);
			const derivativeDigest = await thumbnailDigest(reference.revisionId);
			await context.canonical.delete(canonicalIdentity(derivativeDigest));
			await context.canonical.delete(canonicalIdentity(digestOf(pixelPng)));
			await context.library.runGraphicsReconciliation();

			const overview = await context.library.getReconciliationOverview();
			const discrepancy = openDiscrepancy(overview.discrepancies, 'missing-derivative');
			expect(discrepancy.derivative?.sourceAvailable).toBe(false);
			expect(discrepancy.actions).not.toContain('regenerate-derivative');

			const outcome = await context.library.regenerateGraphicsDerivative({
				discrepancyId: discrepancy.id,
				actor: 'administrator',
			});
			expect(outcome).toMatchObject({
				outcome: 'rejected',
				code: 'source-content-unavailable',
			});
		});
	});

	describe('content the retention path already owns', () => {
		it('raises no incident for unreachable content held for deletion', async () => {
			const context = createReconciliationLibrary();
			const operation = await ingestImage(context, {
				idempotencyKey: 'retention-owned',
				name: 'Retention owned',
			});
			const reference = publishedReference(operation);

			// Trash and purge the asset. Its content row survives the cascade with
			// nothing reaching it, which is exactly what the retention path
			// quarantines for deletion.
			await context.library.trashGraphicAsset({ assetId: reference.assetId });
			await context.library.purgeTrashedGraphicAsset({
				assetId: reference.assetId,
				actor: 'administrator',
				confirmation: 'purge-now',
			});
			await context.library.runGraphicsRetention();
			const quarantined = await harness.client.execute(
				'SELECT digest FROM graphics_content_quarantine',
			);
			expect(quarantined.rows.length).toBeGreaterThan(0);

			// The bytes then go, which is the retention path completing its work.
			await context.canonical.delete(canonicalIdentity(digestOf(pixelPng)));
			const sweep = await context.library.runGraphicsReconciliation();

			// Nothing can reference content no revision reaches, so its bytes
			// disappearing is not an incident and must not reach the queue.
			expect(sweep.content.unavailableDetected).toBe(0);
			expect(sweep.derivatives.missingDetected).toBe(0);
			const overview = await context.library.getReconciliationOverview();
			expect(overview.openCounts['unavailable-content']).toBe(0);
			expect(overview.openCounts['missing-derivative']).toBe(0);
		});

		it('withdraws an incident once the retention path takes the content over', async () => {
			const context = createReconciliationLibrary();
			const operation = await ingestImage(context, {
				idempotencyKey: 'withdrawn',
				name: 'Withdrawn incident',
			});
			const reference = publishedReference(operation);
			await context.canonical.delete(canonicalIdentity(digestOf(pixelPng)));
			await context.library.runGraphicsReconciliation();
			expect((await context.library.getReconciliationOverview())
				.openCounts['unavailable-content']).toBe(1);

			// The asset is then purged, so nothing reaches the content any more.
			await context.library.trashGraphicAsset({ assetId: reference.assetId });
			await context.library.purgeTrashedGraphicAsset({
				assetId: reference.assetId,
				actor: 'administrator',
				confirmation: 'purge-now',
			});
			await context.library.runGraphicsRetention();

			await context.library.runGraphicsReconciliation();

			expect((await context.library.getReconciliationOverview())
				.openCounts['unavailable-content']).toBe(0);
		});
	});

	describe('readers and reconciliation agree on what agreement means', () => {
		it('stops serving content an integrity conflict has isolated', async () => {
			const context = createReconciliationLibrary();
			const operation = await ingestImage(context, {
				idempotencyKey: 'fail-closed',
				name: 'Fail closed',
			});
			const reference = publishedReference(operation);
			const identity = canonicalIdentity(digestOf(pixelPng));

			// The right bytes, size and media type, but the redundant digest
			// metadata publication writes is gone. Reconciliation isolates this,
			// so delivery must refuse it too: content the library is failing
			// closed on must never still be reaching air.
			await context.canonical.delete(identity);
			await context.canonical.createImmutable({
				identity,
				bytes: boundedBytes(pixelPng),
				metadata: { contentType: 'image/png' },
			});

			expect(await context.library.resolveGraphicAssetRevision(reference))
				.toEqual({ outcome: 'unavailable', retryable: true });
			expect(await context.library.inspectGraphicAssetRevision(reference))
				.toEqual({ outcome: 'unavailable', retryable: true });

			const overview = await context.library.getReconciliationOverview();
			const incident = openDiscrepancy(overview.discrepancies, 'critical-integrity-incident');
			expect(incident.reasonCode).toBe('canonical-object-redundant-metadata-mismatch');
		});

		it('reports a preview whose bytes are gone as unavailable, not absent', async () => {
			const context = createReconciliationLibrary();
			const operation = await ingestImage(context, {
				idempotencyKey: 'preview-gone',
				name: 'Preview gone',
			});
			const reference = publishedReference(operation);
			await context.canonical.delete(
				canonicalIdentity(await thumbnailDigest(reference.revisionId)),
			);

			// A recorded Graphics Derivative whose bytes are missing is a retryable
			// operational failure. Reporting it as missing would tell a caller
			// there is no preview when there is one.
			expect(await context.library.resolveGraphicAssetThumbnail({ assetId: reference.assetId }))
				.toEqual({ outcome: 'unavailable', retryable: true });

			// And the reader fed reconciliation on the way out, with no sweep run.
			const overview = await context.library.getReconciliationOverview();
			expect(overview.openCounts['missing-derivative']).toBe(1);
		});

		it('reports an asset with no preview recorded as missing', async () => {
			const context = createReconciliationLibrary();
			expect(await context.library.resolveGraphicAssetThumbnail({
				assetId: 'no-such-asset' as GraphicAssetId,
			})).toEqual({ outcome: 'missing' });
		});
	});

	describe('repair refuses before it writes', () => {
		it('will not restore bytes while an isolated incident is open on the same content', async () => {
			const context = createReconciliationLibrary();
			await ingestImage(context, { idempotencyKey: 'blocked-repair', name: 'Blocked repair' });
			const identity = canonicalIdentity(digestOf(pixelPng));
			await context.canonical.delete(identity);
			await context.library.runGraphicsReconciliation();
			const unavailable = openDiscrepancy(
				(await context.library.getReconciliationOverview()).discrepancies,
				'unavailable-content',
			);

			// Corrupt bytes appear and deep verification isolates them, leaving two
			// open rows on one digest: the original unavailability and the conflict.
			const corrupted = Uint8Array.from(pixelPng);
			corrupted[corrupted.length - 20] = corrupted[corrupted.length - 20]! ^ 0xFF;
			await context.canonical.createImmutable({
				identity,
				bytes: boundedBytes(corrupted),
				metadata: canonicalMetadata(digestOf(pixelPng)),
			});
			await context.library.verifyStoredGraphicAssetContent({
				discrepancyId: unavailable.id,
				actor: 'administrator',
			});
			expect((await context.library.getReconciliationOverview())
				.openCounts['critical-integrity-incident']).toBe(1);

			const outcome = await context.library.repairUnavailableGraphicAssetContent({
				discrepancyId: unavailable.id,
				actor: 'administrator',
				bytes: boundedBytes(pixelPng),
			});

			// Refused before any byte moved, so the ledger cannot claim a refusal
			// over a write that already landed.
			expect(outcome).toMatchObject({
				outcome: 'rejected',
				code: 'integrity-incident-isolated',
			});
			const stored = await context.canonical.readMetadata(identity);
			expect(stored.outcome === 'available' && stored.object.byteLength)
				.toBe(corrupted.byteLength);
			const rejections = await evidenceOf(context.library, {
				categories: ['repair-rejected'],
			});
			expect(rejections.length).toBeGreaterThan(0);
			// A refusal decides nothing and moves nothing, so it records neither a
			// transition nor a quota reading rather than inventing either.
			expect(rejections[0]!.detail).not.toHaveProperty('transition');
			expect(rejections[0]!.detail).not.toHaveProperty('canonicalPressure');
			expect(await evidenceOf(context.library, {
				categories: ['content-repaired'],
			})).toEqual([]);
		});
	});

	describe('administrator-facing state', () => {
		it('states the authority contract and records evidence for every decision', async () => {
			const context = createReconciliationLibrary();
			await ingestImage(context, { idempotencyKey: 'evidence', name: 'Evidence' });
			await context.canonical.delete(canonicalIdentity(digestOf(pixelPng)));
			await context.library.runGraphicsReconciliation();

			const overview = await context.library.getReconciliationOverview();
			expect(overview.authority).toEqual({
				expectedReachability: 'catalogue',
				presentBytes: 'byte-store',
				contentAvailabilityFlag: 'advisory-reconciliation-state',
			});
			expect(overview.lastSweep?.correlationId).toBeDefined();

			const evidence = await evidenceOf(context.library, {
				categories: ['content-unavailable-detected'],
			});
			expect(evidence).toHaveLength(1);
			expect(evidence[0]).toMatchObject({
				outcome: 'content-unavailable',
				reason: 'canonical-object-missing',
				// A discrepancy genuinely transitions, so the entry says so rather
				// than leaving a reader to infer it from the category.
				detail: expect.objectContaining({
					transition: { from: 'none', to: 'open' },
				}),
			});
			// Evidence never carries a digest, object key, or filename.
			expect(JSON.stringify(evidence[0])).not.toContain(digestOf(pixelPng));
		});

		it('rechecks one discrepancy on demand', async () => {
			const context = createReconciliationLibrary();
			await ingestImage(context, { idempotencyKey: 'recheck', name: 'Recheck' });
			const identity = canonicalIdentity(digestOf(pixelPng));
			await context.canonical.delete(identity);
			await context.library.runGraphicsReconciliation();
			const overview = await context.library.getReconciliationOverview();
			const discrepancy = openDiscrepancy(overview.discrepancies, 'unavailable-content');

			expect(await context.library.recheckGraphicsDiscrepancy({
				discrepancyId: discrepancy.id,
				actor: 'administrator',
			})).toMatchObject({ outcome: 'unchanged' });

			await context.canonical.createImmutable({
				identity,
				bytes: boundedBytes(pixelPng),
				metadata: canonicalMetadata(digestOf(pixelPng)),
			});
			expect(await context.library.recheckGraphicsDiscrepancy({
				discrepancyId: discrepancy.id,
				actor: 'administrator',
			})).toMatchObject({ outcome: 'resolved', resolution: 'byte-store-agrees' });
		});

		it('reports an unknown discrepancy identity as not found', async () => {
			const context = createReconciliationLibrary();
			await expect(context.library.inspectGraphicsDiscrepancy({ discrepancyId: 'nope' }))
				.rejects
				.toThrow('Graphics discrepancy not found');
		});
	});
});
