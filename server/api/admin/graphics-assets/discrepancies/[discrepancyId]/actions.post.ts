import { z } from 'zod';
import { requireGraphicsAdministrator } from '~~/server/modules/graphics-administrator';
import { graphicsDiscrepancyId } from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { graphicsAdministratorActor, rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';

/**
 * The actions that need no bytes. Exact-byte repair has its own raw transfer
 * route because it carries content, and adoption of an unexpected object is
 * deliberately absent: it is never an available action.
 */
const actionSchema = z.object({
	action: z.enum(['recheck', 'verify-stored-bytes', 'regenerate-derivative']),
}).strict();

export default defineEventHandler(async (event) => {
	try {
		await requireGraphicsAdministrator(event);
		const { action } = await readValidatedBody(event, actionSchema.parse);
		const library = graphicsAssetLibraryForEvent(event);
		const request = {
			discrepancyId: graphicsDiscrepancyId(getRouterParam(event, 'discrepancyId') ?? ''),
			actor: await graphicsAdministratorActor(event),
		};
		switch (action) {
			case 'recheck':
				return await library.recheckGraphicsDiscrepancy(request);
			case 'verify-stored-bytes':
				return await library.verifyStoredGraphicAssetContent(request);
			case 'regenerate-derivative':
				return await library.regenerateGraphicsDerivative(request);
		}
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error, event);
	}
});
