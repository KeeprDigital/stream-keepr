import { z } from 'zod';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';

const capacityLimitsSchema = z.object({
	canonicalLimitBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
	stagingLimitBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();

// This route belongs to the application's current trusted administrator
// surface. Add installation-admin authorization here when auth is introduced.
export default defineEventHandler(async (event) => {
	try {
		const input = await readValidatedBody(event, capacityLimitsSchema.parse);
		return await graphicsAssetLibraryForEvent(event).updateCapacityLimits(input);
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error);
	}
});
