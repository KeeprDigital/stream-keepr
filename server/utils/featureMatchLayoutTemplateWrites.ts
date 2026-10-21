import type { H3Event } from 'h3';
import type { GraphicsAssetLibrary } from '~~/server/modules/graphics-asset-library';
import type { FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';
import { findFeatureMatchLayoutTemplateLibraryEntry } from '~~/server/modules/feature-match-layout-template-library';
import { assertGraphicsTemplateReferencesSelectable } from '~~/server/utils/graphicsTemplateReferences';
import { featureMatchLayoutGraphicAssetReferences } from '~~/shared/utils/graphicsAssetReferences';

/**
 * What a Feature Match Layout Template is allowed to reference: the graphics
 * Template rule (#614), over the same walk a Feature Match Overlay Screen's layout
 * is discovered by.
 */
export async function assertFeatureMatchLayoutTemplateReferencesSelectable(
	library: Pick<GraphicsAssetLibrary, 'inspectGraphicAssetRevisions'>,
	document: FeatureMatchLayoutConfig,
): Promise<void> {
	await assertGraphicsTemplateReferencesSelectable(
		library,
		featureMatchLayoutGraphicAssetReferences(document),
		'Feature Match Layout Template',
	);
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
