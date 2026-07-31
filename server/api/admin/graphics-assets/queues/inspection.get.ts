import { z } from 'zod';
import { requireGraphicsAdministrator } from '~~/server/modules/graphics-administrator';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';
import { GRAPHICS_OPERATIONAL_QUEUES } from '~~/shared/utils/graphicsOperationalQueues';

/**
 * The queue is part of the request rather than inferred from the subject, so an
 * inspection of a subject that has moved on answers 404 rather than quietly
 * describing it in a state it already left.
 */
const inspectionQuerySchema = z.object({
	queue: z.enum(GRAPHICS_OPERATIONAL_QUEUES),
	subjectId: z.string().min(1).max(200),
}).strict();

/**
 * Everything the persistent inspector shows for one selected queue item. It is
 * composed from durable state on every read, so a selection survives
 * navigation and reload without the surface remembering anything.
 */
export default defineEventHandler(async (event) => {
	try {
		await requireGraphicsAdministrator(event);
		const query = await getValidatedQuery(event, inspectionQuerySchema.parse);
		return await graphicsAssetLibraryForEvent(event).inspectOperationalQueueItem(query);
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error, event);
	}
});
