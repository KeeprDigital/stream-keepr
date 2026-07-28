import { z } from 'zod';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import {
	graphicsAuthorIdentity,
	rethrowGraphicsAssetApiError,
} from '~~/server/utils/graphicsAssetApi';
import { MAX_STILL_IMAGE_INGESTION_BYTES } from '~~/shared/utils/graphicsAssetCompatibility';

const initiationSchema = z.object({
	idempotencyKey: z.string().trim().min(1).max(200),
	name: z.string().trim().min(1).max(200),
	sourceFileName: z.string().trim().min(1).max(255).optional(),
	declaredMime: z.string().trim().min(1).max(255).optional(),
	browserDecodeEvidence: z.discriminatedUnion('outcome', [
		z.object({
			outcome: z.literal('decoded'),
			sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
			width: z.number().int().positive(),
			height: z.number().int().positive(),
		}).strict(),
		z.object({
			outcome: z.literal('rejected'),
			sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
		}).strict(),
	]).optional(),
	defaultEventId: z.number().int().positive().optional(),
	duplicateContentPolicy: z.enum(['reuse', 'create-separate']).optional(),
	declaredByteLength: z.number().int().positive().max(MAX_STILL_IMAGE_INGESTION_BYTES),
}).strict();

export default defineEventHandler(async (event) => {
	try {
		const input = await readValidatedBody(event, initiationSchema.parse);
		const operation = await graphicsAssetLibraryForEvent(event).initiateImageIngestion({
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
