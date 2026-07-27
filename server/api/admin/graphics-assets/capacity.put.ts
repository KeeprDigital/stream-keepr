import { z } from 'zod';
import { requireGraphicsAdministrator } from '~~/server/modules/graphics-administrator';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';

const capacityLimitsSchema = z.object({
	canonicalLimitBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
	stagingLimitBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();

export default defineEventHandler(async (event) => {
	try {
		await requireGraphicsAdministrator(event);
		const input = await readValidatedBody(event, capacityLimitsSchema.parse);
		return await graphicsAssetLibraryForEvent(event).updateCapacityLimits(input);
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error);
	}
});
