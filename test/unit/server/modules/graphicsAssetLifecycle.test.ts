import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	createGraphicsAssetLibrary,
	createInMemoryGraphicsAssetCatalogue,
} from '~~/server/modules/graphics-asset-library';
import {
	createInMemoryCanonicalGraphicsObjectStore,
	createInMemoryStagingGraphicsObjectStore,
} from '~~/server/modules/graphics-asset-library/in-memory-object-store';
import { createBoundedByteStream } from '~~/server/modules/graphics-asset-library/object-store';

const lifecyclePixelPng = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
));

function createLifecycleLibrary() {
	let currentTime = new Date('2026-07-28T00:00:00.000Z');
	let nextIdentity = 0;
	const library = createGraphicsAssetLibrary({
		catalogue: createInMemoryGraphicsAssetCatalogue(),
		staging: createInMemoryStagingGraphicsObjectStore(),
		canonical: createInMemoryCanonicalGraphicsObjectStore(),
		now: () => currentTime,
		generateIdentity: () => `lifecycle-identity-${++nextIdentity}`,
	});
	return {
		library,
		setCurrentTime(value: string) {
			currentTime = new Date(value);
		},
	};
}

async function ingestLifecycleAsset(
	library: ReturnType<typeof createLifecycleLibrary>['library'],
) {
	const operation = await library.initiateGraphicsIngestion({
		idempotencyKey: 'lifecycle-recovery-window',
		initiatedBy: 'lifecycle-author',
		name: 'Recovery-window logo',
		sourceFileName: 'logo.png',
		declaredMime: 'image/png',
		browserDecodeEvidence: {
			outcome: 'decoded',
			sourceDigest: createHash('sha256').update(lifecyclePixelPng).digest('hex'),
			width: 1,
			height: 1,
		},
		declaredByteLength: lifecyclePixelPng.byteLength,
	});
	return await library.uploadGraphicAsset({
		operationId: operation.id,
		initiatedBy: operation.initiatedBy,
		declaredMime: 'image/png',
		bytes: createBoundedByteStream(lifecyclePixelPng, {
			byteLength: lifecyclePixelPng.byteLength,
			maximumByteLength: lifecyclePixelPng.byteLength,
		}),
	});
}

describe('the Graphics Asset Library recovery window', () => {
	it('restores within 30 days but rejects restoration after the recovery deadline', async () => {
		const withinWindow = createLifecycleLibrary();
		const first = await ingestLifecycleAsset(withinWindow.library);
		const firstAssetId = first.result!.assetId;
		await withinWindow.library.trashGraphicAsset({ assetId: firstAssetId });
		withinWindow.setCurrentTime('2026-08-26T23:59:59.999Z');
		await expect(withinWindow.library.restoreGraphicAsset({
			assetId: firstAssetId,
		})).resolves.toMatchObject({
			outcome: 'restored',
			asset: { lifecycle: { state: 'active' } },
		});

		const expired = createLifecycleLibrary();
		const second = await ingestLifecycleAsset(expired.library);
		const secondAssetId = second.result!.assetId;
		await expired.library.trashGraphicAsset({ assetId: secondAssetId });
		expired.setCurrentTime('2026-08-27T00:00:00.001Z');
		await expect(expired.library.restoreGraphicAsset({
			assetId: secondAssetId,
		})).rejects.toMatchObject({
			code: 'graphic-asset-lifecycle-action-not-allowed',
		});
		await expect(expired.library.listGraphicAssets({
			lifecycleStates: ['trashed'],
		})).resolves.toEqual([
			expect.objectContaining({
				id: secondAssetId,
				lifecycle: expect.objectContaining({ state: 'trashed' }),
			}),
		]);
	});
});
