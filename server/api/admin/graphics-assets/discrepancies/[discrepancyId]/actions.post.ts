import { z } from 'zod';
import { requireGraphicsAdministrator } from '~~/server/modules/graphics-administrator';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { graphicsAuthorIdentity, rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';

/**
 * The actions that need no bytes. Exact-byte repair has its own raw transfer
 * route because it carries content, and adoption of an unexpected object is
 * deliberately absent: it is never an available action.
 */
const actionSchema = z.object({
	action: z.enum(['recheck', 'restore-quarantined-copy', 'regenerate-derivative']),
}).strict();

export default defineEventHandler(async (event) => {
	try {
		await requireGraphicsAdministrator(event);
		const { action } = await readValidatedBody(event, actionSchema.parse);
		const library = graphicsAssetLibraryForEvent(event);
		const request = {
			discrepancyId: getRouterParam(event, 'discrepancyId') ?? '',
			actor: graphicsAuthorIdentity(event),
		};
		switch (action) {
			case 'recheck':
				return await library.recheckGraphicsDiscrepancy(request);
			case 'restore-quarantined-copy':
				return await library.restoreQuarantinedGraphicAssetContent(request);
			case 'regenerate-derivative':
				return await library.regenerateGraphicsDerivative(request);
		}
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error, event);
	}
});
