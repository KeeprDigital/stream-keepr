import type { SqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createD1GraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library/catalogue';
import { consumeBoundedByteStream } from '~~/server/modules/graphics-asset-library/object-store';
import { createTestGraphicsLibrary } from '~~/test/helpers/graphicsLibrary';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { ingestPackageStaticFont } from '~~/test/helpers/templatePackageLibrary';

let harness: SqliteD1Harness;

beforeEach(async () => {
	harness = await createSqliteD1Harness();
});

afterEach(async () => {
	await harness.close();
});

// The facade's one font-evidence case. The evidence rules (challenge binding,
// fallback-dependent proofs, replacement) are held at ingestion's own seam:
// graphicsAssetIngestionFont.sqlite.test.ts.
describe('static font ingestion through the Graphics Asset Library public module', () => {
	it('publishes one browser-proven static face and resolves its exact source revision', async () => {
		const source = new Uint8Array(await readFile('public/fonts/mplantin.woff'));
		const { library } = createTestGraphicsLibrary({
			catalogue: createD1GraphicsAssetCatalogue(harness.database),
		});

		const reference = await ingestPackageStaticFont(library, 'MPlantin');

		await expect(library.listGraphicAssets({})).resolves.toMatchObject([
			{
				id: reference.assetId,
				kind: 'font',
				revisionId: reference.revisionId,
			},
		]);
		const resolved = await library.resolveGraphicAssetRevision(reference);
		expect(resolved).toMatchObject({
			outcome: 'available',
			contentType: 'font/woff',
		});
		if (resolved.outcome !== 'available')
			throw new Error('Expected exact font revision content');
		await expect(consumeBoundedByteStream({
			body: resolved.body,
			byteLength: resolved.byteLength,
			maximumByteLength: source.byteLength,
		})).resolves.toEqual(source);
	});
});
