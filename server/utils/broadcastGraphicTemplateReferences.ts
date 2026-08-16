import type { GraphicsAssetLibrary } from '~~/server/modules/graphics-asset-library';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import { graphicAssetId, graphicAssetRevisionId } from '~~/server/modules/graphics-asset-library';
import { broadcastGraphicsGraphicAssetReferences } from '~~/shared/utils/graphicsAssetReferences';

/**
 * What a Broadcast Graphic Template is allowed to reference.
 *
 * The rule is narrower than the Screen write path's on purpose, and the difference
 * is the whole point: a Screen refuses a *newly chosen* revision that is not
 * selectable right now, while a template is allowed to pin a revision whose asset
 * has since been retired — a pinned revision keeps resolving, and a template is a
 * design an author saved months ago rather than a selection they are making now.
 *
 * What a template must never store is a reference to a revision that does not
 * exist at all. Nothing would resolve it, the reference index would record nothing
 * (its insert selects from the revisions table), and so no Missing Graphic Asset
 * Reference would be persisted anywhere — the library would show a healthy template
 * that fails only at placement, at which point the failure names a Graphic Item id
 * the author has never seen. Refusing the write is what keeps the library's own
 * listing honest.
 *
 * `unavailable` is deliberately accepted: the revision exists and its content is
 * temporarily unresolvable, which is a retryable condition of the object store
 * rather than a property of the reference.
 */
export async function assertBroadcastGraphicTemplateReferencesExist(
	library: Pick<GraphicsAssetLibrary, 'inspectGraphicAssetRevisions'>,
	document: BroadcastGraphicConfig,
): Promise<void> {
	const references = broadcastGraphicsGraphicAssetReferences({ graphics: [document] });
	if (references.length === 0)
		return;

	// One catalogue round-trip for the whole document, statuses aligned by input
	// index — the #374 batching, which a template save needs for the same reason a
	// Screen config save did: its item stacks are the same order of size (#382).
	const statuses = await library.inspectGraphicAssetRevisions({
		references: references.map(item => ({
			assetId: graphicAssetId(item.reference.assetId),
			revisionId: graphicAssetRevisionId(item.reference.revisionId),
		})),
	});
	const missing = references
		.filter((_, index) => statuses[index]?.outcome === 'missing')
		.map(item => item.ownerSlot);

	if (missing.length > 0) {
		throw createError({
			statusCode: 409,
			statusMessage: 'Conflict',
			message: `Broadcast Graphic Template references Graphic Asset Revisions that do not exist: ${missing.join(', ')}`,
		});
	}
}
