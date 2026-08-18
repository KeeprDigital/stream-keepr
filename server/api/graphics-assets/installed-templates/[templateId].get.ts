import { installedGraphicsTemplateId } from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { requireUserId } from '~~/server/utils/auth';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';

/**
 * One graphics Template a Template Package installed here, with the exact local
 * revisions its rewritten references pin. A Template exists only once its
 * complete installation committed, so reading one is also the proof that no
 * partial installation is discoverable.
 */
export default defineEventHandler(async (event) => {
	await requireUserId(event);
	try {
		return await graphicsAssetLibraryForEvent(event).inspectInstalledGraphicsTemplate({
			templateId: installedGraphicsTemplateId(getRouterParam(event, 'templateId') ?? ''),
		});
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error, event);
	}
});
