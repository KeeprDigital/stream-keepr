import type { GraphicAssetId, GraphicAssetImageFacts } from '~~/shared/types/graphicsAsset';
import type { SqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	graphicAssetId,
	graphicAssetRevisionId,
	graphicsDerivativeId,
	graphicsIngestionOperationId,
} from '~~/server/modules/graphics-asset-library';
import { createD1GraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library/catalogue';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * What one ingestion publication commits when it holds, or has lost, its claim: driven at
 * the catalogue on real SQLite, because what a guarded statement writes is the subject.
 */

let harness: SqliteD1Harness;

beforeEach(async () => {
	harness = await createSqliteD1Harness();
});

afterEach(async () => await harness.close());

const SOURCE_DIGEST = 'a'.repeat(64);
const THUMBNAIL_DIGEST = 'b'.repeat(64);
const REPLACEMENT_DIGEST = 'c'.repeat(64);
const REPLACEMENT_THUMBNAIL_DIGEST = 'd'.repeat(64);
/** The Event a reuse runs inside, for the arm that takes its third statement. */
const DEFAULT_EVENT_ID = 7;

function acceptedReport(digest: string) {
	return {
		outcome: 'accepted' as const,
		compatibilityProfile: 'still-image-v1' as const,
		issues: [] as [],
		facts: {
			kind: 'image',
			format: 'png',
			canonicalMime: 'image/png',
			byteLength: 70,
			sha256: digest,
			width: 1,
			height: 1,
			pixelCount: 1,
			frameCount: 1,
			bitDepth: 8,
			colorSpace: 'srgb',
			colorModel: 'rgba',
			hasAlpha: true,
			orientation: 'normal',
		} satisfies GraphicAssetImageFacts,
	};
}

type Catalogue = ReturnType<typeof createD1GraphicsAssetCatalogue>;

/** Drives one operation to the stage its publication commits against. */
async function claimedOperation(
	catalogue: Catalogue,
	key: string,
	options: {
		stage?: 'publishing' | 'generating-derivatives';
		targetAssetId?: GraphicAssetId;
		duplicateContentPolicy?: 'reuse' | 'create-separate';
		defaultEventId?: number;
	} = {},
) {
	const created = await catalogue.initiateGraphicsIngestion({
		id: graphicsIngestionOperationId(key),
		idempotencyKey: key,
		source: 'local-upload',
		initiatedBy: 'graphics-author',
		name: 'Logo',
		sourceFileName: 'logo.png',
		declaredMime: 'image/png',
		targetAssetId: options.targetAssetId,
		defaultEventId: options.defaultEventId,
		duplicateContentPolicy: options.duplicateContentPolicy ?? 'create-separate',
		declaredByteLength: 70,
		transferredByteLength: 70,
		stage: 'created',
		createdAt: new Date(1_000).toISOString(),
		updatedAt: new Date(1_000).toISOString(),
	});
	return await catalogue.updateIngestionOperation(
		{
			...created,
			stage: options.stage ?? 'publishing',
			updatedAt: new Date(2_000).toISOString(),
		},
		created.updatedAt,
	);
}

/** The bytes a run has written and the orphan clock they are still under. */
async function arrangeReclaimableState(
	catalogue: Catalogue,
	operation: Awaited<ReturnType<typeof claimedOperation>>,
	digests: readonly string[],
) {
	await catalogue.recordCanonicalWrites({
		operation,
		contents: digests.map(digest => ({ digest, byteLength: 70 })),
		recordedAt: new Date(2_500).toISOString(),
	});
	for (const digest of digests) {
		await harness.client.execute({
			sql: `
				INSERT INTO graphics_content_quarantine (
					id, digest, byte_length, origin, quarantined_at, delete_after, created_at
				) VALUES (?, ?, 70, 'orphaned-content', 0, 1, 0)
			`,
			args: [`quarantined-${digest.slice(0, 4)}`, digest],
		});
	}
}

/** The publication input for `operation`, naming its rows after `name`. */
function publicationOf(
	operation: Awaited<ReturnType<typeof claimedOperation>>,
	name: string,
	options: { source?: string; thumbnail?: string; at?: number } = {},
) {
	const source = options.source ?? SOURCE_DIGEST;
	return {
		operation,
		report: acceptedReport(source),
		assetId: graphicAssetId(name),
		revisionId: graphicAssetRevisionId(`${name}-revision`),
		derivativeId: graphicsDerivativeId(`${name}-derivative`),
		sourceDigest: source,
		thumbnailDigest: options.thumbnail ?? THUMBNAIL_DIGEST,
		thumbnailByteLength: 90,
		publishedAt: new Date(options.at ?? 3_000).toISOString(),
	};
}

/** `operation` as held by an attempt another attempt has since moved on. */
function staleSnapshot<Operation extends { updatedAt: string }>(operation: Operation): Operation {
	return {
		...operation,
		updatedAt: new Date(9_000).toISOString(),
	};
}

/** An asset already in the library, as the arm about to reuse it sees it. */
async function publishedAsset(catalogue: Catalogue, key: string, assetId: GraphicAssetId) {
	const operation = await claimedOperation(catalogue, key);
	await catalogue.publishGraphicAsset(publicationOf(operation, assetId));
	const current = await catalogue.findCurrentGraphicAsset(assetId);
	if (!current)
		throw new Error(`Test setup failed to publish ${assetId}`);
	return current;
}

async function countOf(table: string) {
	const result = await harness.client.execute(`SELECT COUNT(*) AS total FROM ${table}`);
	return Number(result.rows[0]?.total);
}

describe('an ordinary ingestion publication that holds its claim', () => {
	// Under the reuse policy the guard must not see the asset this very batch inserts.
	it('publishes and reclaims both while asking whether the content is already held', async () => {
		const catalogue = createD1GraphicsAssetCatalogue(harness.database);
		const operation = await claimedOperation(catalogue, 'upload-reuse-policy', {
			duplicateContentPolicy: 'reuse',
		});
		await arrangeReclaimableState(catalogue, operation, [SOURCE_DIGEST, THUMBNAIL_DIGEST]);

		const published = await catalogue.publishGraphicAsset(publicationOf(operation, 'published-asset'));

		expect(published.stage).toBe('completed');
		expect(await countOf('graphic_assets')).toBe(1);
		expect(await countOf('graphic_asset_revisions')).toBe(1);
		expect(await countOf('graphics_derivatives')).toBe(1);
		expect(await countOf('graphic_asset_contents')).toBe(2);
		// These bytes are reachable now, so the orphan quarantine holding them is
		// released and the candidate records that stood in for them are spent.
		expect(await countOf('graphics_content_quarantine')).toBe(0);
		expect(await countOf('graphics_canonical_write_candidates')).toBe(0);
	});

	it('publishes and reclaims both when a replacement holds its claim', async () => {
		const catalogue = createD1GraphicsAssetCatalogue(harness.database);
		const target = graphicAssetId('replaced-target');
		await publishedAsset(catalogue, 'upload-before-replacement', target);

		const replacement = await claimedOperation(catalogue, 'replacement-held-claim', {
			targetAssetId: target,
		});
		await arrangeReclaimableState(catalogue, replacement, [
			REPLACEMENT_DIGEST,
			REPLACEMENT_THUMBNAIL_DIGEST,
		]);

		const published = await catalogue.publishGraphicAssetReplacement({
			...publicationOf(replacement, 'replaced', { source: REPLACEMENT_DIGEST, thumbnail: REPLACEMENT_THUMBNAIL_DIGEST, at: 4_000 }),
			targetAssetId: target,
			assetId: target,
		});

		expect(published.stage).toBe('completed');
		expect(published.result?.outcome).toBe('revision-created');
		expect(await countOf('graphic_asset_revisions')).toBe(2);
		expect(await countOf('graphics_content_quarantine')).toBe(0);
		expect(await countOf('graphics_canonical_write_candidates')).toBe(0);
	});

	it('spends the write candidates of a reuse that holds its claim', async () => {
		const catalogue = createD1GraphicsAssetCatalogue(harness.database);
		const reused = await publishedAsset(catalogue, 'upload-before-reuse', graphicAssetId('reused-asset'));
		const operation = await claimedOperation(catalogue, 'reuse-held-claim', {
			duplicateContentPolicy: 'reuse',
		});
		await arrangeReclaimableState(catalogue, operation, [SOURCE_DIGEST, THUMBNAIL_DIGEST]);

		const completed = await catalogue.reuseGraphicAsset({
			operation,
			reusable: reused,
			publishedAt: new Date(4_000).toISOString(),
		});

		expect(completed.stage).toBe('completed');
		expect(completed.result?.outcome).toBe('reused');
		expect(await countOf('graphics_canonical_write_candidates')).toBe(0);
		// The arm returns what it built, so only the committed row proves the transition landed.
		await expect(catalogue.getIngestionOperation(operation.id, operation.initiatedBy))
			.resolves
			.toMatchObject({
				stage: 'completed',
				result: { outcome: 'reused' },
			});
	});

	it('spends the write candidates of a replacement no-op that holds its claim', async () => {
		const catalogue = createD1GraphicsAssetCatalogue(harness.database);
		const target = graphicAssetId('noop-target');
		const current = await publishedAsset(catalogue, 'upload-before-noop', target);
		const operation = await claimedOperation(catalogue, 'noop-held-claim', {
			targetAssetId: target,
		});
		await arrangeReclaimableState(catalogue, operation, [SOURCE_DIGEST, THUMBNAIL_DIGEST]);

		const completed = await catalogue.completeGraphicAssetReplacementNoop({
			operation,
			current,
			completedAt: new Date(4_000).toISOString(),
		});

		expect(completed.stage).toBe('completed');
		expect(completed.result?.outcome).toBe('replacement-noop');
		expect(await countOf('graphics_canonical_write_candidates')).toBe(0);
		// Same reason as the reuse arm above: the return value is built, not read.
		await expect(catalogue.getIngestionOperation(operation.id, operation.initiatedBy))
			.resolves
			.toMatchObject({
				stage: 'completed',
				result: { outcome: 'replacement-noop' },
			});
	});

	// A default Event gives the reuse arm a third guarded statement.
	it('associates a reused asset with the Event its operation ran inside', async () => {
		const catalogue = createD1GraphicsAssetCatalogue(harness.database);
		await harness.client.execute(`
			INSERT INTO events (id, name, game, feature_match_orientation)
			VALUES (${DEFAULT_EVENT_ID}, 'Reuse inside an Event', 'mtg', 'landscape')
		`);
		const reused = await publishedAsset(
			catalogue,
			'upload-before-event-reuse',
			graphicAssetId('event-reused-asset'),
		);
		const operation = await claimedOperation(catalogue, 'reuse-inside-event', {
			duplicateContentPolicy: 'reuse',
			defaultEventId: DEFAULT_EVENT_ID,
		});
		await arrangeReclaimableState(catalogue, operation, [SOURCE_DIGEST, THUMBNAIL_DIGEST]);

		const completed = await catalogue.reuseGraphicAsset({
			operation,
			reusable: reused,
			publishedAt: new Date(4_000).toISOString(),
		});

		expect(completed.result?.outcome).toBe('reused');
		const associations = await harness.client.execute(
			'SELECT asset_id, event_id FROM graphic_asset_event_associations',
		);
		expect(associations.rows.map(row => ({
			assetId: row.asset_id,
			eventId: Number(row.event_id),
		}))).toEqual([
			{ assetId: 'event-reused-asset', eventId: DEFAULT_EVENT_ID },
		]);
		expect(await countOf('graphics_canonical_write_candidates')).toBe(0);
	});
});

describe('an ordinary ingestion publication that lost its claim', () => {
	it('reclaims neither the quarantine nor the write candidates it never earned', async () => {
		const catalogue = createD1GraphicsAssetCatalogue(harness.database);
		const operation = await claimedOperation(catalogue, 'upload-lost-claim');
		await arrangeReclaimableState(catalogue, operation, [SOURCE_DIGEST, THUMBNAIL_DIGEST]);

		// Another attempt moved the operation on, so this one is publishing
		// against a claim it no longer holds.
		await expect(catalogue.publishGraphicAsset(publicationOf(staleSnapshot(operation), 'lost-claim-asset')))
			.rejects
			.toThrow(/lost its claim/i);

		// Candidates still account for the bytes; the quarantine keeps its existing orphan clock.
		expect(await countOf('graphics_canonical_write_candidates')).toBe(2);
		expect(await countOf('graphics_content_quarantine')).toBe(2);
		expect(await countOf('graphic_assets')).toBe(0);
		expect(await countOf('graphic_asset_revisions')).toBe(0);
		expect(await countOf('graphic_asset_contents')).toBe(0);
	});

	it('reclaims neither of them when a replacement loses its claim', async () => {
		const catalogue = createD1GraphicsAssetCatalogue(harness.database);
		const target = graphicAssetId('replacement-target');
		await publishedAsset(catalogue, 'upload-for-replacement', target);

		const replacement = await claimedOperation(catalogue, 'replacement-lost-claim', {
			targetAssetId: target,
		});
		await arrangeReclaimableState(catalogue, replacement, [
			REPLACEMENT_DIGEST,
			REPLACEMENT_THUMBNAIL_DIGEST,
		]);

		await expect(catalogue.publishGraphicAssetReplacement({
			...publicationOf(staleSnapshot(replacement), 'replacement', { source: REPLACEMENT_DIGEST, thumbnail: REPLACEMENT_THUMBNAIL_DIGEST, at: 4_000 }),
			targetAssetId: target,
			assetId: target,
		})).rejects.toThrow(/replacement publication/i);

		expect(await countOf('graphics_canonical_write_candidates')).toBe(2);
		expect(await countOf('graphics_content_quarantine')).toBe(2);
		// The asset keeps the one revision it had, so nothing released those
		// bytes back into reach.
		expect(await countOf('graphic_asset_revisions')).toBe(1);
	});

	// Its transition matching nothing is not an error, so a re-read would report the winner's success.
	it('does not report a reuse it lost the claim to as its own success', async () => {
		const catalogue = createD1GraphicsAssetCatalogue(harness.database);
		const reused = await publishedAsset(catalogue, 'upload-before-lost-reuse', graphicAssetId('reused-asset'));
		const operation = await claimedOperation(catalogue, 'reuse-lost-claim', {
			duplicateContentPolicy: 'reuse',
		});
		await arrangeReclaimableState(catalogue, operation, [SOURCE_DIGEST, THUMBNAIL_DIGEST]);

		// The attempt that won the race completes the operation first.
		await catalogue.updateIngestionOperation(
			{
				...operation,
				stage: 'completed',
				updatedAt: new Date(5_000).toISOString(),
			},
			operation.updatedAt,
		);

		await expect(catalogue.reuseGraphicAsset({
			operation,
			reusable: reused,
			publishedAt: new Date(6_000).toISOString(),
		})).rejects.toThrow(/lost its claim/i);

		expect(await countOf('graphics_canonical_write_candidates')).toBe(2);
	});

	it('reclaims no write candidates when a replacement no-op loses its claim', async () => {
		const catalogue = createD1GraphicsAssetCatalogue(harness.database);
		const target = graphicAssetId('noop-lost-claim-target');
		const current = await publishedAsset(catalogue, 'upload-before-lost-noop', target);
		const operation = await claimedOperation(catalogue, 'noop-lost-claim', {
			targetAssetId: target,
		});
		await arrangeReclaimableState(catalogue, operation, [SOURCE_DIGEST, THUMBNAIL_DIGEST]);

		await expect(catalogue.completeGraphicAssetReplacementNoop({
			operation: staleSnapshot(operation),
			current,
			completedAt: new Date(4_000).toISOString(),
		})).rejects.toThrow(/lost its claim/i);

		expect(await countOf('graphics_canonical_write_candidates')).toBe(2);
	});

	// Moves the stage alone to pin the guard's stage conjunct. The candidate count is
	// load-bearing: the refusal alone survives that conjunct being dropped.
	it('completes no replacement no-op once the operation has left the publishing stage', async () => {
		const catalogue = createD1GraphicsAssetCatalogue(harness.database);
		const target = graphicAssetId('noop-stage-moved-target');
		const current = await publishedAsset(catalogue, 'upload-before-stage-moved-noop', target);
		const operation = await claimedOperation(catalogue, 'noop-stage-moved', {
			targetAssetId: target,
		});
		await arrangeReclaimableState(catalogue, operation, [SOURCE_DIGEST, THUMBNAIL_DIGEST]);
		await harness.client.execute({
			sql: 'UPDATE graphics_ingestion_operations SET stage = ? WHERE id = ?',
			args: ['completed', operation.id],
		});

		await expect(catalogue.completeGraphicAssetReplacementNoop({
			operation,
			current,
			completedAt: new Date(4_000).toISOString(),
		})).rejects.toThrow(/lost its claim/i);

		expect(await countOf('graphics_canonical_write_candidates')).toBe(2);
	});

	// The reuse arm's stage conjunct, pinned the same way as the no-op's.
	it('reuses no asset once the operation has left the publishing stage', async () => {
		const catalogue = createD1GraphicsAssetCatalogue(harness.database);
		const reused = await publishedAsset(
			catalogue,
			'upload-before-stage-moved-reuse',
			graphicAssetId('stage-moved-reused-asset'),
		);
		const operation = await claimedOperation(catalogue, 'reuse-stage-moved', {
			duplicateContentPolicy: 'reuse',
		});
		await arrangeReclaimableState(catalogue, operation, [SOURCE_DIGEST, THUMBNAIL_DIGEST]);
		await harness.client.execute({
			sql: 'UPDATE graphics_ingestion_operations SET stage = ? WHERE id = ?',
			args: ['completed', operation.id],
		});

		await expect(catalogue.reuseGraphicAsset({
			operation,
			reusable: reused,
			publishedAt: new Date(4_000).toISOString(),
		})).rejects.toThrow(/lost its claim/i);

		expect(await countOf('graphics_canonical_write_candidates')).toBe(2);
	});

	it('associates a reused asset with no Event when the reuse lost its claim', async () => {
		const catalogue = createD1GraphicsAssetCatalogue(harness.database);
		await harness.client.execute(`
			INSERT INTO events (id, name, game, feature_match_orientation)
			VALUES (${DEFAULT_EVENT_ID}, 'Reuse inside an Event', 'mtg', 'landscape')
		`);
		const reused = await publishedAsset(
			catalogue,
			'upload-before-lost-event-reuse',
			graphicAssetId('event-lost-reuse-asset'),
		);
		const operation = await claimedOperation(catalogue, 'reuse-inside-event-lost-claim', {
			duplicateContentPolicy: 'reuse',
			defaultEventId: DEFAULT_EVENT_ID,
		});
		await arrangeReclaimableState(catalogue, operation, [SOURCE_DIGEST, THUMBNAIL_DIGEST]);

		await expect(catalogue.reuseGraphicAsset({
			operation: staleSnapshot(operation),
			reusable: reused,
			publishedAt: new Date(4_000).toISOString(),
		})).rejects.toThrow(/lost its claim/i);

		// The association organises discovery around a publication that happened.
		// This one did not, so the Event learns nothing about the asset.
		expect(await countOf('graphic_asset_event_associations')).toBe(0);
		expect(await countOf('graphics_canonical_write_candidates')).toBe(2);
	});
});

describe('reserving canonical capacity for an ordinary publication', () => {
	it('distinguishes a lost claim from a library with no room left', async () => {
		const catalogue = createD1GraphicsAssetCatalogue(harness.database);
		const operation = await claimedOperation(catalogue, 'reservation-lost-claim', {
			stage: 'generating-derivatives',
		});

		// The library has every byte of its quota free, so capacity cannot be
		// what refuses this: the only thing left is the claim.
		const reservation = await catalogue.reserveGraphicAssetPublication({
			operation: staleSnapshot(operation),
			sourceDigest: SOURCE_DIGEST,
			sourceByteLength: 70,
			thumbnailDigest: THUMBNAIL_DIGEST,
			thumbnailByteLength: 90,
			reservedAt: new Date(3_000).toISOString(),
		});

		expect(reservation.outcome).toBe('lost-claim');
	});
});
