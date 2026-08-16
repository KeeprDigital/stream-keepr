import type { H3Event } from 'h3';
import type { GraphicsAssetLibrary } from '~~/server/modules/graphics-asset-library';
import type { FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';
import { findFeatureMatchLayoutTemplateLibraryEntry } from '~~/server/modules/feature-match-layout-template-library';
import { graphicAssetId, graphicAssetRevisionId } from '~~/server/modules/graphics-asset-library';
import { featureMatchLayoutGraphicAssetReferences } from '~~/shared/utils/graphicsAssetReferences';

/**
 * What a Feature Match Layout Template is allowed to reference.
 *
 * The same rule the Broadcast Graphic Template library applies, for the same
 * reason. A template may pin a revision whose asset has since been retired — a
 * pinned revision keeps resolving, and a design saved months ago is not a selection
 * being made now. What it must never store is a reference to a revision that does
 * not exist at all: nothing would resolve it, the reference index would record
 * nothing, and the library would list a healthy template that fails only when
 * somebody places it.
 *
 * `unavailable` is accepted: the revision exists and its content is temporarily
 * unresolvable, which is a condition of the object store rather than of the
 * reference.
 */
export async function assertFeatureMatchLayoutTemplateReferencesExist(
	library: Pick<GraphicsAssetLibrary, 'inspectGraphicAssetRevisions'>,
	document: FeatureMatchLayoutConfig,
): Promise<void> {
	const references = featureMatchLayoutGraphicAssetReferences(document);
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
			message: `Feature Match Layout Template references Graphic Asset Revisions that do not exist: ${missing.join(', ')}`,
		});
	}
}

/**
 * Turn "the authored store does not have it" into the right refusal.
 *
 * The library reads from two stores and writes to one. A write that finds nothing
 * may still name a layout the author can see — one a Template Package installed,
 * which lives in the Graphics Asset Library's own record and which this library
 * never writes. A `404` there would be false about something on screen, so the miss
 * is resolved against the library as a whole and an installed entry is refused with
 * the route back: place it, and save the placed layout.
 *
 * Returns normally when the identity names nothing at all, leaving the caller to
 * report its own `404`.
 */
export async function refuseInstalledFeatureMatchLayoutTemplateWrite(
	event: H3Event,
	templateId: string,
	attempted: 'revised' | 'deleted',
): Promise<void> {
	const entry = await findFeatureMatchLayoutTemplateLibraryEntry(event, templateId);
	if (!entry || entry.authored)
		return;
	throw createError({
		statusCode: 409,
		statusMessage: 'Conflict',
		message: `Feature Match Layout Template "${entry.name}" was installed from a Template Package and cannot be ${attempted} here. Place it on a Screen and save the placed layout to get a design this installation owns.`,
	});
}
