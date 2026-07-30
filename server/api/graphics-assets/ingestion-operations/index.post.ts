import { z } from 'zod';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import {
	graphicsAuthorIdentity,
	rethrowGraphicsAssetApiError,
} from '~~/server/utils/graphicsAssetApi';
import { TEMPLATE_PACKAGE_LIMITS } from '~~/shared/types/templatePackage';
import { MAX_SILENT_VIDEO_INGESTION_BYTES } from '~~/shared/utils/graphicsAssetCompatibility';

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
	// An approved remote copy cannot declare an exact length up front: the length
	// is only knowable from the remote response, and remains an untrusted hint
	// until the observed bytes match it.
	source: z.enum(['local-upload', 'remote-copy']).optional(),
	declaredByteLength: z.number().int().positive().max(MAX_SILENT_VIDEO_INGESTION_BYTES).optional(),
}).strict().refine(
	input => input.source === 'remote-copy'
		? input.declaredByteLength === undefined
		: input.declaredByteLength !== undefined,
	{
		error: 'A local upload must declare its byte length; an approved remote copy must not.',
		path: ['declaredByteLength'],
	},
);

/**
 * A received Template Package is an envelope rather than one Graphic Asset, so
 * it declares no media kind, carries no per-asset browser evidence, names no
 * asset, and is bounded by the archive limit instead of any one asset kind's.
 * Everything inside it is declared by its own manifest and proven by preflight.
 */
const templatePackageInitiationSchema = z.object({
	idempotencyKey: z.string().trim().min(1).max(200),
	source: z.literal('template-package'),
	sourceFileName: z.string().trim().min(1).max(255).optional(),
	defaultEventId: z.number().int().positive().optional(),
	declaredByteLength: z.number().int().positive().max(TEMPLATE_PACKAGE_LIMITS.maximumArchiveByteLength),
}).strict();

export default defineEventHandler(async (event) => {
	try {
		const body = await readBody(event);
		const library = graphicsAssetLibraryForEvent(event);
		const initiatedBy = graphicsAuthorIdentity(event);
		if ((body as { source?: unknown } | null)?.source === 'template-package') {
			const { source: _packageSource, ...packageInput }
				= templatePackageInitiationSchema.parse(body);
			const started = await library.initiateTemplatePackagePreflight({
				...packageInput,
				initiatedBy,
			});
			setResponseStatus(event, 201);
			return started;
		}
		const { source, declaredByteLength, ...input } = initiationSchema.parse(body);
		const operation = source === 'remote-copy'
			? await library.initiateRemoteGraphicAssetCopy({ ...input, initiatedBy })
			: await library.initiateGraphicsIngestion({
					...input,
					initiatedBy,
					declaredByteLength: declaredByteLength!,
				});
		setResponseStatus(event, 201);
		return operation;
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error);
	}
});
