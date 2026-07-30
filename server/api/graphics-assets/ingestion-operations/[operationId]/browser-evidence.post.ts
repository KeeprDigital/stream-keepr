import { z } from 'zod';
import { graphicsIngestionOperationId } from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import {
	graphicsAuthorIdentity,
	rethrowGraphicsAssetApiError,
} from '~~/server/utils/graphicsAssetApi';

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const proofSchema = z.object({
	codePoint: z.number().int().min(0).max(0x10FFFF),
	exactWithSansDigest: digestSchema,
	exactWithMonoDigest: digestSchema,
	sansFallbackDigest: digestSchema,
	monoFallbackDigest: digestSchema,
}).strict();
const evidenceSchema = z.discriminatedUnion('outcome', [
	z.object({
		outcome: z.literal('decoded'),
		sourceDigest: digestSchema,
		width: z.number().int().positive(),
		height: z.number().int().positive(),
	}).strict(),
	z.object({
		outcome: z.literal('rejected'),
		sourceDigest: digestSchema,
	}).strict(),
	z.object({
		outcome: z.literal('font-loaded'),
		sourceDigest: digestSchema,
		challengeDigest: digestSchema,
		glyphProofs: z.array(proofSchema).min(1).max(8),
	}).strict(),
	z.object({
		outcome: z.literal('font-rejected'),
		sourceDigest: digestSchema,
		challengeDigest: digestSchema,
		stage: z.enum(['load', 'render']),
	}).strict(),
]);

export default defineEventHandler(async (event) => {
	try {
		const evidence = await readValidatedBody(event, evidenceSchema.parse);
		return await graphicsAssetLibraryForEvent(event).confirmGraphicAssetBrowserEvidence({
			operationId: graphicsIngestionOperationId(getRouterParam(event, 'operationId') ?? ''),
			initiatedBy: graphicsAuthorIdentity(event),
			evidence,
		});
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error, event);
	}
});
