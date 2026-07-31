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
 * What one ordinary ingestion publication commits when its claim is gone.
 *
 * A lost claim is a race between two attempts at one operation, so it cannot be
 * staged through the library seam without contriving the race itself. It can be
 * handed to the catalogue directly, which is where the condition every statement
 * commits against lives — and it needs genuine SQLite, because what a statement
 * writes when its own condition is false is exactly what is under test.
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
	options: { stage?: 'publishing' | 'generating-derivatives'; targetAssetId?: GraphicAssetId } = {},
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
		duplicateContentPolicy: 'create-separate',
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

async function countOf(table: string) {
	const result = await harness.client.execute(`SELECT COUNT(*) AS total FROM ${table}`);
	return Number(result.rows[0]?.total);
}

describe('an ordinary ingestion publication that lost its claim', () => {
	it('reclaims neither the quarantine nor the write candidates it never earned', async () => {
		const catalogue = createD1GraphicsAssetCatalogue(harness.database);
		const operation = await claimedOperation(catalogue, 'upload-lost-claim');
		await arrangeReclaimableState(catalogue, operation, [SOURCE_DIGEST, THUMBNAIL_DIGEST]);

		// Another attempt moved the operation on, so this one is publishing
		// against a claim it no longer holds.
		await expect(catalogue.publishGraphicAsset({
			operation: { ...operation, updatedAt: new Date(9_000).toISOString() },
			report: acceptedReport(SOURCE_DIGEST),
			assetId: graphicAssetId('lost-claim-asset'),
			revisionId: graphicAssetRevisionId('lost-claim-revision'),
			derivativeId: graphicsDerivativeId('lost-claim-derivative'),
			sourceDigest: SOURCE_DIGEST,
			thumbnailDigest: THUMBNAIL_DIGEST,
			thumbnailByteLength: 90,
			publishedAt: new Date(3_000).toISOString(),
		})).rejects.toThrow(/lost its claim/i);

		// The bytes this run wrote stay accounted for by the candidate machinery
		// built to collect them, and content still unreachable keeps the orphan
		// clock it was already under rather than starting a fresh seven days.
		expect(await countOf('graphics_canonical_write_candidates')).toBe(2);
		expect(await countOf('graphics_content_quarantine')).toBe(2);
		expect(await countOf('graphic_assets')).toBe(0);
		expect(await countOf('graphic_asset_revisions')).toBe(0);
		expect(await countOf('graphic_asset_contents')).toBe(0);
	});

	it('reclaims neither of them when a replacement loses its claim', async () => {
		const catalogue = createD1GraphicsAssetCatalogue(harness.database);
		const first = await claimedOperation(catalogue, 'upload-for-replacement');
		const target = graphicAssetId('replacement-target');
		await catalogue.publishGraphicAsset({
			operation: first,
			report: acceptedReport(SOURCE_DIGEST),
			assetId: target,
			revisionId: graphicAssetRevisionId('replacement-target-revision'),
			derivativeId: graphicsDerivativeId('replacement-target-derivative'),
			sourceDigest: SOURCE_DIGEST,
			thumbnailDigest: THUMBNAIL_DIGEST,
			thumbnailByteLength: 90,
			publishedAt: new Date(3_000).toISOString(),
		});

		const replacement = await claimedOperation(catalogue, 'replacement-lost-claim', {
			targetAssetId: target,
		});
		await arrangeReclaimableState(catalogue, replacement, [
			REPLACEMENT_DIGEST,
			REPLACEMENT_THUMBNAIL_DIGEST,
		]);

		await expect(catalogue.publishGraphicAssetReplacement({
			operation: { ...replacement, updatedAt: new Date(9_000).toISOString() },
			targetAssetId: target,
			report: acceptedReport(REPLACEMENT_DIGEST),
			assetId: target,
			revisionId: graphicAssetRevisionId('replacement-revision'),
			derivativeId: graphicsDerivativeId('replacement-derivative'),
			sourceDigest: REPLACEMENT_DIGEST,
			thumbnailDigest: REPLACEMENT_THUMBNAIL_DIGEST,
			thumbnailByteLength: 90,
			publishedAt: new Date(4_000).toISOString(),
		})).rejects.toThrow();

		expect(await countOf('graphics_canonical_write_candidates')).toBe(2);
		expect(await countOf('graphics_content_quarantine')).toBe(2);
		// The asset keeps the one revision it had, so nothing released those
		// bytes back into reach.
		expect(await countOf('graphic_asset_revisions')).toBe(1);
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
			operation: { ...operation, updatedAt: new Date(9_000).toISOString() },
			sourceDigest: SOURCE_DIGEST,
			sourceByteLength: 70,
			thumbnailDigest: THUMBNAIL_DIGEST,
			thumbnailByteLength: 90,
			reservedAt: new Date(3_000).toISOString(),
		});

		expect(reservation.outcome).toBe('lost-claim');
	});
});
