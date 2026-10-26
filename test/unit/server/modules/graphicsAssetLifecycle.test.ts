import { describe, expect, it } from 'vitest';
import { createInMemoryGraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library';
import { createTestGraphicsLibrary, DAY, ingestImage, publishedRevision } from '~~/test/helpers/graphicsLibrary';

const RECOVERY_WINDOW = 30 * DAY;

async function trashedAsset() {
	const context = createTestGraphicsLibrary({
		catalogue: createInMemoryGraphicsAssetCatalogue(),
		identityPrefix: 'lifecycle',
	});
	const { assetId } = publishedRevision(await ingestImage(context, { idempotencyKey: 'lifecycle-recovery-window' }));
	await context.library.trashGraphicAsset({ assetId });
	const trashedAt = context.now().getTime();
	return {
		...context,
		assetId,
		at: (offset: number) => context.advanceTo(new Date(trashedAt + offset).toISOString()),
	};
}

describe('the Graphics Asset Library recovery window', () => {
	it('restores a Trashed Graphic Asset up to the last instant of its 30 days', async () => {
		const { library, assetId, at } = await trashedAsset();
		at(RECOVERY_WINDOW - 1);

		await expect(library.restoreGraphicAsset({ assetId })).resolves.toMatchObject({
			outcome: 'restored',
			asset: {
				lifecycle: { state: 'active' },
			},
		});
	});

	it('refuses restoration after the recovery deadline and leaves the asset in Trash', async () => {
		const { library, assetId, at } = await trashedAsset();
		at(RECOVERY_WINDOW + 1);

		await expect(library.restoreGraphicAsset({ assetId })).rejects.toMatchObject({
			code: 'graphic-asset-lifecycle-action-not-allowed',
		});
		await expect(library.listGraphicAssets({
			lifecycleStates: ['trashed'],
		})).resolves.toEqual([
			expect.objectContaining({
				id: assetId,
				lifecycle: expect.objectContaining({ state: 'trashed' }),
			}),
		]);
	});
});
