import type { GraphicsDiscrepancy } from '~~/shared/types/graphicsAsset';
import type { SqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createD1GraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library/catalogue';
import { processStillImage } from '~~/server/modules/graphics-asset-library/still-image';
import { digestOf } from '~~/test/helpers/graphicsFixtures';
import { jpegDeclaring } from '~~/test/helpers/graphicsImageFixtures';
import { boundedBytes, createTestGraphicsLibrary } from '~~/test/helpers/graphicsLibrary';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

const codecs = vi.hoisted(() => ({
	decodeJpeg: vi.fn(),
	decodeWebp: vi.fn(),
}));
vi.mock('~~/runtime/graphics-still-image-codecs', () => codecs);

const OVER_CAP = { width: 3840, height: 2161 };
const overCapJpeg = jpegDeclaring(OVER_CAP.width, OVER_CAP.height);

let harness: SqliteD1Harness;

beforeEach(async () => {
	harness = await createSqliteD1Harness();
	codecs.decodeJpeg.mockResolvedValue({
		...OVER_CAP,
		data: new Uint8ClampedArray(OVER_CAP.width * OVER_CAP.height * 4),
	});
});

afterEach(async () => {
	await harness.close();
});

/** The catalogue rows of a JPEG revision accepted before the cap, with no bytes behind them. */
async function seedRevisionAcceptedBeforeTheCap() {
	const accepted = await processStillImage(overCapJpeg, {}, { bounds: 'stored' });
	const sourceDigest = digestOf(overCapJpeg);
	const thumbnailDigest = digestOf(accepted.thumbnail);
	await harness.client.batch([
		{
			sql: 'INSERT INTO graphic_asset_contents (digest, byte_length, canonical_mime) VALUES (?, ?, ?), (?, ?, ?)',
			args: [
				sourceDigest,
				overCapJpeg.byteLength,
				'image/jpeg',
				thumbnailDigest,
				accepted.thumbnail.byteLength,
				'image/png',
			],
		},
		{
			sql: 'INSERT INTO graphic_assets (id, name, kind) VALUES (\'asset-before-cap\', \'Before the cap\', \'image\')',
			args: [],
		},
		{
			sql: `
				INSERT INTO graphic_asset_revisions (id, asset_id, revision_number, content_digest, compatibility_profile, technical_facts)
				VALUES ('revision-before-cap', 'asset-before-cap', 1, ?, 'still-image-v1', ?)
			`,
			args: [
				sourceDigest,
				JSON.stringify(accepted.report.facts),
			],
		},
		{
			sql: `
				INSERT INTO graphics_derivatives (id, source_revision_id, kind, content_digest)
				VALUES ('derivative-before-cap', 'revision-before-cap', 'thumbnail', ?)
			`,
			args: [thumbnailDigest],
		},
	], 'write');
}

function openDiscrepancy(discrepancies: readonly GraphicsDiscrepancy[], kind: GraphicsDiscrepancy['kind']) {
	const found = discrepancies.find(discrepancy => discrepancy.kind === kind);
	if (!found)
		throw new Error(`No open ${kind} discrepancy was recorded`);
	return found;
}

describe('a JPEG revision accepted before the full-decode pixel cap', () => {
	// The cap is an ingestion rule: reconciliation still verifies exact repair
	// bytes for the stored revision and still reproduces its thumbnail.
	it('is repaired from its exact bytes and gets its thumbnail regenerated', async () => {
		await seedRevisionAcceptedBeforeTheCap();
		const context = createTestGraphicsLibrary({
			catalogue: createD1GraphicsAssetCatalogue(harness.database),
			start: '2026-07-30T00:00:00.000Z',
		});
		await context.library.runGraphicsReconciliation();
		const unavailable = openDiscrepancy(
			(await context.library.getReconciliationOverview()).discrepancies,
			'unavailable-content',
		);

		const repaired = await context.library.repairUnavailableGraphicAssetContent({
			discrepancyId: unavailable.id,
			actor: 'administrator',
			bytes: boundedBytes(overCapJpeg),
		});

		expect(repaired).toMatchObject({ outcome: 'resolved' });

		context.advance(1000);
		await context.library.runGraphicsReconciliation();
		const missing = openDiscrepancy(
			(await context.library.getReconciliationOverview()).discrepancies,
			'missing-derivative',
		);

		const regenerated = await context.library.regenerateGraphicsDerivative({
			discrepancyId: missing.id,
			actor: 'administrator',
		});

		expect(regenerated).toMatchObject({ outcome: 'resolved', resolution: 'derivative-regenerated' });
	});
});
