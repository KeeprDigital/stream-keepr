import { z } from 'zod';
import { graphicsIngestionOperationId } from '~~/server/modules/graphics-asset-library';
import { createBoundedByteStream } from '~~/server/modules/graphics-asset-library/object-store';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import {
	graphicsAuthorIdentity,
	rethrowGraphicsAssetApiError,
} from '~~/server/utils/graphicsAssetApi';
import { getBoundedRequestBodyStream } from '~~/server/utils/payloadLimits';

const evidenceSchema = z.discriminatedUnion('outcome', [
	z.object({
		outcome: z.literal('video-played'),
		challengeId: z.string().min(16).max(200),
		operationId: z.string().min(1).max(200).transform(graphicsIngestionOperationId),
		factsDigest: z.string().regex(/^[a-f0-9]{64}$/),
		sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
		width: z.number().int().positive(),
		height: z.number().int().positive(),
		durationSeconds: z.number().positive().finite(),
		posterTimeSeconds: z.number().nonnegative().finite(),
		posterDigest: z.string().regex(/^[a-f0-9]{64}$/),
		browserFamily: z.enum(['chromium', 'safari', 'other']),
		transparencyRendered: z.boolean(),
	}).strict(),
	z.object({
		outcome: z.literal('video-rejected'),
		challengeId: z.string().min(16).max(200),
		operationId: z.string().min(1).max(200).transform(graphicsIngestionOperationId),
		factsDigest: z.string().regex(/^[a-f0-9]{64}$/),
		sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
		browserFamily: z.enum(['chromium', 'safari', 'other']),
		stage: z.enum(['metadata', 'playback', 'seek', 'poster', 'transparency']),
	}).strict(),
]);

export default defineEventHandler(async (event) => {
	try {
		const encodedEvidence = getHeader(event, 'x-stream-keepr-video-evidence');
		if (!encodedEvidence)
			throw createError({ statusCode: 400, message: 'Silent video browser evidence header is required' });
		const base64Evidence = encodedEvidence.replaceAll('-', '+').replaceAll('_', '/');
		const binaryEvidence = atob(base64Evidence.padEnd(Math.ceil(base64Evidence.length / 4) * 4, '='));
		const evidence = evidenceSchema.parse(JSON.parse(
			new TextDecoder().decode(Uint8Array.from(binaryEvidence, character => character.charCodeAt(0))),
		));
		const poster = getBoundedRequestBodyStream(event);
		const posterByteLength = Number(getHeader(event, 'content-length') ?? 0);
		if (
			evidence.outcome === 'video-played'
			&& (!poster || !Number.isSafeInteger(posterByteLength) || posterByteLength <= 0)
		) {
			throw createError({ statusCode: 400, message: 'Bounded deterministic video poster is required' });
		}
		return await graphicsAssetLibraryForEvent(event).confirmSilentVideoBrowserEvidence({
			operationId: graphicsIngestionOperationId(getRouterParam(event, 'operationId') ?? ''),
			initiatedBy: graphicsAuthorIdentity(event),
			evidence,
			poster: poster && posterByteLength > 0
				? createBoundedByteStream(poster, {
						byteLength: posterByteLength,
						maximumByteLength: 2 * 1024 * 1024,
					})
				: undefined,
		});
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error, event);
	}
});
