import { z } from 'zod';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import {
	graphicsAuthorIdentity,
	rethrowGraphicsAssetApiError,
} from '~~/server/utils/graphicsAssetApi';
import { MAX_PNG_INGESTION_BYTES } from '~~/shared/utils/graphicsAssetCompatibility';

const initiationSchema = z.object({
	idempotencyKey: z.string().trim().min(1).max(200),
	name: z.string().trim().min(1).max(200),
	defaultEventId: z.number().int().positive().optional(),
	declaredByteLength: z.number().int().positive().max(MAX_PNG_INGESTION_BYTES),
}).strict();

export default defineEventHandler(async (event) => {
	try {
		const input = await readValidatedBody(event, initiationSchema.parse);
		const operation = await graphicsAssetLibraryForEvent(event).initiatePngIngestion({
			...input,
			initiatedBy: graphicsAuthorIdentity(event),
		});
		setResponseStatus(event, 201);
		return operation;
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error);
	}
});
