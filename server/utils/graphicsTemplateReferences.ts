import type { GraphicsAssetLibrary } from '~~/server/modules/graphics-asset-library';
import type { GraphicAssetReferenceStatus } from '~~/shared/types/graphicsAsset';
import type { ScreenGraphicAssetReference } from '~~/shared/utils/graphicsAssetReferences';
import { graphicAssetId, graphicAssetRevisionId } from '~~/server/modules/graphics-asset-library';

/** Which graphics Template library a write belongs to, as an author reads it. */
export type GraphicsTemplateArtifact = 'Broadcast Graphic Template' | 'Feature Match Layout Template';

const KIND_NOUNS: Record<ScreenGraphicAssetReference['kind'], string> = {
	'image': 'an image',
	'silent-video': 'a silent video',
	'font': 'a font',
};

/**
 * Why one reference cannot be written into a template, or null when it can.
 *
 * A hole in the batch answer fails closed, as the Screen write path's does: a
 * reference the library did not answer for has not been shown to exist.
 */
function refusal(
	item: ScreenGraphicAssetReference,
	status: GraphicAssetReferenceStatus | undefined,
): string | null {
	if (status === undefined || status.outcome === 'missing')
		return 'does not exist';
	if (status.outcome === 'unavailable')
		return 'content unavailable';
	if (status.lifecycleState !== 'active')
		return status.lifecycleState;
	if (status.kind !== item.kind)
		return `is ${KIND_NOUNS[status.kind]}, not ${KIND_NOUNS[item.kind]}`;
	return null;
}

/**
 * What a graphics Template is allowed to reference (#614).
 *
 * Every template write, for both template kinds, requires each Graphic Asset
 * Reference its document holds to be one an author could select right now: an
 * existing revision whose content is available, of an active Graphic Asset, whose
 * kind fits the item, input, or typography slot that names it. There is no
 * retained-reference exemption — a rename re-states every reference the template
 * already holds, exactly as the save that first wrote it did.
 *
 * This is the route's question, asked before the write so a refusal names every
 * slot and why. The template store asks the catalogue half of it again inside the
 * statement that commits, so a retirement landing in between still refuses the
 * write. Content availability is the byte store's, which no transaction can see,
 * so it is checked here only.
 *
 * One catalogue round-trip for the whole document, statuses aligned by input index
 * — the #374 batching, which a template save needs for the same reason a Screen
 * config save did: its item stacks are the same order of size (#382).
 */
export async function assertGraphicsTemplateReferencesSelectable(
	library: Pick<GraphicsAssetLibrary, 'inspectGraphicAssetRevisions'>,
	references: readonly ScreenGraphicAssetReference[],
	artifact: GraphicsTemplateArtifact,
): Promise<void> {
	await assertGraphicsTemplatesReferencesSelectable(library, [{ references }], artifact);
}

/**
 * The same question about several templates one operation writes together — a
 * Graphic Style Set operation rewriting every template it reaches — asked in one
 * round-trip. A refusal names each template it belongs to.
 */
export async function assertGraphicsTemplatesReferencesSelectable(
	library: Pick<GraphicsAssetLibrary, 'inspectGraphicAssetRevisions'>,
	templates: ReadonlyArray<{ name?: string; references: readonly ScreenGraphicAssetReference[] }>,
	artifact: GraphicsTemplateArtifact,
): Promise<void> {
	const references = templates.flatMap(template => template.references);
	if (references.length === 0)
		return;

	const statuses = await library.inspectGraphicAssetRevisions({
		references: references.map(item => ({
			assetId: graphicAssetId(item.reference.assetId),
			revisionId: graphicAssetRevisionId(item.reference.revisionId),
		})),
	});
	let offset = 0;
	const refusals = templates.flatMap((template) => {
		const refused = template.references.flatMap((item, index) => {
			const reason = refusal(item, statuses[offset + index]);
			return reason === null ? [] : [`${item.ownerSlot} (${reason})`];
		});
		offset += template.references.length;
		if (refused.length === 0)
			return [];
		const subject = template.name === undefined ? artifact : `${artifact} "${template.name}"`;
		return [`${subject} cannot reference these Graphic Asset Revisions: ${refused.join(', ')}`];
	});

	if (refusals.length > 0) {
		throw createError({
			statusCode: 409,
			statusMessage: 'Conflict',
			message: refusals.join('; '),
		});
	}
}

/** The answer a template store's commit-time reference refusal becomes. */
export function graphicsTemplateReferenceConflict(artifact: GraphicsTemplateArtifact) {
	return createError({
		statusCode: 409,
		statusMessage: 'Conflict',
		message: `A Graphic Asset Revision this ${artifact} references stopped being selectable while it was being saved. Reload it, then replace or restore the asset.`,
	});
}
