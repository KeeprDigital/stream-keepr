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
 * The set-wise revision content lookup, against genuine SQLite (#374).
 *
 * `findRevisionContents` exists so an authored save's selectability checks cost
 * one catalogue round-trip whatever the save's size, and the one thing it must
 * never do is answer differently from the singular `findRevisionContent` it
 * stands in for — so the pin here is parity, pair by pair, plus the set
 * semantics the docblock promises: duplicates fold, absences leave no hole.
 */

let harness: SqliteD1Harness;

beforeEach(async () => {
	harness = await createSqliteD1Harness();
});

afterEach(async () => await harness.close());

type Catalogue = ReturnType<typeof createD1GraphicsAssetCatalogue>;

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

async function publishedAsset(catalogue: Catalogue, key: string, assetId: GraphicAssetId, digest: string) {
	const created = await catalogue.initiateGraphicsIngestion({
		id: graphicsIngestionOperationId(key),
		idempotencyKey: key,
		source: 'local-upload',
		initiatedBy: 'graphics-author',
		name: `Logo ${key}`,
		sourceFileName: 'logo.png',
		declaredMime: 'image/png',
		duplicateContentPolicy: 'create-separate',
		declaredByteLength: 70,
		transferredByteLength: 70,
		stage: 'created',
		createdAt: new Date(1_000).toISOString(),
		updatedAt: new Date(1_000).toISOString(),
	});
	const operation = await catalogue.updateIngestionOperation(
		{
			...created,
			stage: 'publishing',
			updatedAt: new Date(2_000).toISOString(),
		},
		created.updatedAt,
	);
	await catalogue.publishGraphicAsset({
		operation,
		report: acceptedReport(digest),
		assetId,
		revisionId: graphicAssetRevisionId(`${assetId}-revision`),
		derivativeId: graphicsDerivativeId(`${assetId}-derivative`),
		sourceDigest: digest,
		thumbnailDigest: `${digest.slice(0, 32)}${'f'.repeat(32)}`,
		thumbnailByteLength: 90,
		publishedAt: new Date(3_000).toISOString(),
	});
	return {
		assetId,
		revisionId: graphicAssetRevisionId(`${assetId}-revision`),
	};
}

describe('findRevisionContents against genuine SQLite', () => {
	it('answers one row per distinct resolvable pair, in parity with the singular lookup', async () => {
		const catalogue = createD1GraphicsAssetCatalogue(harness.database);
		const logo = await publishedAsset(catalogue, 'logo', graphicAssetId('asset-logo'), 'a'.repeat(64));
		const banner = await publishedAsset(catalogue, 'banner', graphicAssetId('asset-banner'), 'b'.repeat(64));
		const missing = {
			assetId: logo.assetId,
			revisionId: graphicAssetRevisionId('missing-revision'),
		};

		const rows = await catalogue.findRevisionContents([logo, banner, missing, logo]);

		// Two distinct resolvable pairs: the duplicate folded, the miss left no hole.
		expect(rows.map(row => ({ assetId: row.assetId, revisionId: row.revisionId })))
			.toEqual(expect.arrayContaining([logo, banner]));
		expect(rows).toHaveLength(2);

		// Parity: each row is the singular lookup's answer plus the pair it is for.
		for (const pair of [logo, banner]) {
			const singular = await catalogue.findRevisionContent(pair);
			expect(rows.find(row => row.revisionId === pair.revisionId)).toEqual({
				...pair,
				...singular,
			});
		}
	});

	it('answers an empty batch without touching the database', async () => {
		const catalogue = createD1GraphicsAssetCatalogue(harness.database);
		await expect(catalogue.findRevisionContents([])).resolves.toEqual([]);
	});
});
