import { z } from 'zod';
import { graphicAssetId } from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';

const metadataSchema = z.object({
	name: z.string().trim().min(1).max(200),
	eventIds: z.array(z.number().int().positive()).max(100),
}).strict();

/**
 * The Library Workspace's rename and Event re-association.
 *
 * Installation-wide like the lifecycle actions, so any graphics author may edit
 * any active asset — but only a graphics author. The Event set is replaced
 * rather than merged and carries no lower bound, so an empty array is a valid
 * request that detaches the asset from every Event it belongs to; that is a
 * decision, and a caller with no session has no standing to make it.
 *
 * Unlike the lifecycle route beside this one, it deliberately writes no
 * Evidence Ledger entry (#174). The ledger records lifecycle and
 * reconciliation decisions — every entry carries a state transition, a
 * reference proof, bytes, a quota reading, or a deadline — and an authoring
 * metadata edit has none of those: the asset stays active, no Graphic Asset
 * Reference moves, and nothing starts toward cleanup, because purge
 * protection is reference-based rather than association-based. Metadata is
 * also outside revision history by design, so an entry here would record the
 * one kind of change the domain deliberately keeps no history of.
 */
export default defineEventHandler(async (event) => {
	await requireGraphicsAuthorSession(event);
	try {
		const input = await readValidatedBody(event, metadataSchema.parse);
		return await graphicsAssetLibraryForEvent(event).updateGraphicAsset({
			assetId: graphicAssetId(getRouterParam(event, 'assetId') ?? ''),
			...input,
		});
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error, event);
	}
});
