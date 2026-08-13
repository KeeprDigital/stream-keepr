import { z } from 'zod';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';
import { TEMPLATE_PACKAGE_LIMITS } from '~~/shared/types/templatePackage';
import { MAX_SILENT_VIDEO_INGESTION_BYTES } from '~~/shared/utils/graphicsAssetCompatibility';

const browserDecodeEvidenceSchema = z.discriminatedUnion('outcome', [
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
]);

const graphicAssetDeclarations = {
	idempotencyKey: z.string().trim().min(1).max(200),
	name: z.string().trim().min(1).max(200),
	sourceFileName: z.string().trim().min(1).max(255).optional(),
	declaredMime: z.string().trim().min(1).max(255).optional(),
	browserDecodeEvidence: browserDecodeEvidenceSchema.optional(),
	defaultEventId: z.number().int().positive().optional(),
	duplicateContentPolicy: z.enum(['reuse', 'create-separate']).optional(),
} as const;

const localUploadSchema = z.object({
	...graphicAssetDeclarations,
	source: z.literal('local-upload'),
	declaredByteLength: z.number().int().positive().max(MAX_SILENT_VIDEO_INGESTION_BYTES),
}).strict();

/**
 * An approved remote copy cannot declare an exact length up front: the length is
 * only knowable from the remote response, and remains an untrusted hint until
 * the observed bytes match it.
 */
const remoteCopySchema = z.object({
	...graphicAssetDeclarations,
	source: z.literal('remote-copy'),
}).strict();

/**
 * A received Template Package is an envelope rather than one Graphic Asset, so
 * it declares no media kind, carries no per-asset browser evidence, names no
 * asset, and is bounded by the archive limit instead of any one asset kind's.
 * Everything inside it is declared by its own manifest and proven by preflight.
 */
const templatePackageSchema = z.object({
	idempotencyKey: z.string().trim().min(1).max(200),
	source: z.literal('template-package'),
	sourceFileName: z.string().trim().min(1).max(255).optional(),
	defaultEventId: z.number().int().positive().optional(),
	// Named, because a refused package is refused for being a package: a reader
	// told only that some byte length was too large goes looking at the Graphic
	// Asset transfer limits, which describe a different envelope entirely.
	declaredByteLength: z.number().int().positive().max(
		TEMPLATE_PACKAGE_LIMITS.maximumArchiveByteLength,
		`Template Package must not exceed ${TEMPLATE_PACKAGE_LIMITS.maximumArchiveByteLength} bytes`,
	),
}).strict();

/**
 * The source decides which envelope applies, so it discriminates the schema.
 * It stays optional on the wire — a client uploading a file has always been able
 * to omit it — and is filled in before the union sees the body.
 */
const initiationSchema = z.preprocess(
	value => (
		typeof value === 'object'
		&& value !== null
		&& !Array.isArray(value)
		&& (value as { source?: unknown }).source === undefined
			? { ...value, source: 'local-upload' }
			: value
	),
	z.discriminatedUnion('source', [
		localUploadSchema,
		remoteCopySchema,
		templatePackageSchema,
	]),
);

/**
 * The initiating author is the authenticated graphics author session and nothing
 * else. Every later route on the operation resolves the same way, so the identity
 * an operation is created under is exactly the identity that can work it: an
 * operation UUID is a name, not a right.
 */
export default defineEventHandler(async (event) => {
	const initiatedBy = await requireGraphicsAuthorSession(event);
	try {
		const body = await readValidatedBody(event, initiationSchema.parse);
		const library = graphicsAssetLibraryForEvent(event);
		const operation = await (async () => {
			switch (body.source) {
				case 'template-package': {
					const { source: _source, ...input } = body;
					return await library.initiateTemplatePackagePreflight({ ...input, initiatedBy });
				}
				case 'remote-copy': {
					const { source: _source, ...input } = body;
					return await library.initiateRemoteGraphicAssetCopy({ ...input, initiatedBy });
				}
				case 'local-upload': {
					const { source: _source, ...input } = body;
					return await library.initiateGraphicsIngestion({ ...input, initiatedBy });
				}
			}
		})();
		setResponseStatus(event, 201);
		return operation;
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error, event);
	}
});
