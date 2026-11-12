import type { SqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createD1GraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library/catalogue';
import { createBoundedByteStream } from '~~/server/modules/graphics-asset-library/object-store';
import { GRAPHICS_MULTIPART_PART_BYTES } from '~~/shared/utils/graphicsAssetCompatibility';
import { digestOf, pngOfByteLength } from '~~/test/helpers/graphicsFixtures';
import { createTestGraphicsLibrary, decodeEvidence } from '~~/test/helpers/graphicsLibrary';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

let harness: SqliteD1Harness;

beforeEach(async () => {
	harness = await createSqliteD1Harness();
});

afterEach(async () => {
	await harness.close();
});

// The facade's one multipart case. The transfer's rules (verified parts, part
// claims, retries, cleanup) are held at ingestion's own seam:
// graphicsAssetIngestionMultipart.sqlite.test.ts.
describe('resumable image ingestion through the Graphics Asset Library public module', () => {
	it('publishes a multipart transfer through the normal pipeline', async () => {
		const bytes = pngOfByteLength(GRAPHICS_MULTIPART_PART_BYTES + 1);
		const { library } = createTestGraphicsLibrary({
			catalogue: createD1GraphicsAssetCatalogue(harness.database),
		});
		const operation = await library.initiateGraphicsIngestion({
			idempotencyKey: 'large-scoreboard-logo',
			initiatedBy: 'graphics-author-1',
			name: 'Large scoreboard logo',
			declaredMime: 'image/png',
			browserDecodeEvidence: decodeEvidence(bytes),
			declaredByteLength: bytes.byteLength,
		});
		const transfer = { operationId: operation.id, initiatedBy: operation.initiatedBy };

		const started = await library.startGraphicAssetMultipartUpload(transfer);
		expect(started).toMatchObject({
			stage: 'transferring',
			transfer: { method: 'multipart', partCount: 2 },
		});
		for (const [index, part] of [
			bytes.subarray(0, GRAPHICS_MULTIPART_PART_BYTES),
			bytes.subarray(GRAPHICS_MULTIPART_PART_BYTES),
		].entries()) {
			await library.uploadGraphicAssetMultipartPart({
				...transfer,
				partNumber: index + 1,
				bytes: createBoundedByteStream(part, {
					byteLength: part.byteLength,
					maximumByteLength: GRAPHICS_MULTIPART_PART_BYTES,
				}),
			});
		}
		const completed = await library.completeGraphicAssetMultipartUpload(transfer);

		expect(completed).toMatchObject({
			stage: 'completed',
			transferredByteLength: bytes.byteLength,
			result: { outcome: 'published' },
			report: {
				outcome: 'accepted',
				facts: {
					byteLength: bytes.byteLength,
					sha256: digestOf(bytes),
				},
			},
		});
		await expect(library.listGraphicAssets({})).resolves.toEqual([
			expect.objectContaining({
				id: completed.result?.assetId,
				revisionId: completed.result?.revisionId,
			}),
		]);
	});
});
