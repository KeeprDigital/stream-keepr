import type { SqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createD1GraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library/catalogue';
import { createGraphicsRemoteSourceFetcher } from '~~/server/modules/graphics-asset-library/remote-source';
import { pixelPng as transparentPixelPng } from '~~/test/helpers/graphicsFixtures';
import { createTestGraphicsLibrary, decodeEvidence } from '~~/test/helpers/graphicsLibrary';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

let harness: SqliteD1Harness;

beforeEach(async () => {
	harness = await createSqliteD1Harness();
});

afterEach(async () => {
	await harness.close();
});

// The facade's one remote-copy case. The copy's rules (destination and redirect
// checks, lengths, the multipart checkpoint, reuse, cancellation) are held at
// ingestion's own seam: graphicsAssetIngestionRemoteCopy.sqlite.test.ts.
describe('approved remote HTTPS copy through the Graphics Asset Library public module', () => {
	it('publishes an ordinary local Graphic Asset from a confirmed one-time copy', async () => {
		const { library } = createTestGraphicsLibrary({
			catalogue: createD1GraphicsAssetCatalogue(harness.database),
			remoteSource: createGraphicsRemoteSourceFetcher({
				resolver: {
					async resolve() {
						return {
							outcome: 'resolved',
							addresses: ['93.184.216.34'],
						};
					},
				},
				async fetch() {
					return new Response(transparentPixelPng, {
						status: 200,
						headers: {
							'content-length': String(transparentPixelPng.byteLength),
						},
					});
				},
			}),
		});
		const operation = await library.initiateRemoteGraphicAssetCopy({
			idempotencyKey: 'remote-copy-1',
			initiatedBy: 'graphics-author-1',
			name: 'Remote scoreboard',
			sourceFileName: 'scoreboard.png',
		});

		const copied = await library.copyRemoteGraphicAssetSource({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			sourceUrl: 'https://cdn.example.test/scoreboard.png',
		});
		expect(copied).toMatchObject({
			source: 'remote-copy',
			stage: 'awaiting-confirmation',
		});
		const completed = await library.confirmGraphicAssetBrowserEvidence({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			evidence: decodeEvidence(transparentPixelPng),
		});

		expect(completed).toMatchObject({
			stage: 'completed',
			result: { outcome: 'published' },
		});
		await expect(library.listGraphicAssets({})).resolves.toHaveLength(1);
		await expect(library.resolveGraphicAssetRevision({
			assetId: completed.result!.assetId,
			revisionId: completed.result!.revisionId,
		})).resolves.toMatchObject({
			outcome: 'available',
			contentType: 'image/png',
			byteLength: transparentPixelPng.byteLength,
		});
	});
});
