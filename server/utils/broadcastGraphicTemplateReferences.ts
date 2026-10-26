import type { GraphicsAssetLibrary } from '~~/server/modules/graphics-asset-library';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import {
	assertGraphicsTemplateReferencesSelectable,
	assertGraphicsTemplatesReferencesSelectable,
} from '~~/server/utils/graphicsTemplateReferences';
import { broadcastGraphicsGraphicAssetReferences } from '~~/shared/utils/graphicsAssetReferences';

/**
 * What a Broadcast Graphic Template is allowed to reference: the graphics Template
 * rule (#614), over the same walk a Broadcast Graphics Screen's stack is discovered
 * by, so a template and the copy placed from it agree on what they pin.
 */
export async function assertBroadcastGraphicTemplateReferencesSelectable(
	library: Pick<GraphicsAssetLibrary, 'inspectGraphicAssetRevisions'>,
	document: BroadcastGraphicConfig,
): Promise<void> {
	await assertGraphicsTemplateReferencesSelectable(
		library,
		broadcastGraphicsGraphicAssetReferences({
			graphics: [document],
		}),
		'Broadcast Graphic Template',
	);
}

/**
 * The same rule over every Broadcast Graphic Template one Graphic Style Set
 * operation rewrites, each refusal naming its template as the library lists it.
 * One refusal refuses the whole operation (ADR-0034); the batch asks again.
 */
export async function assertStyleSetRewritesReferencesSelectable(
	library: Pick<GraphicsAssetLibrary, 'inspectGraphicAssetRevisions'>,
	rewrites: ReadonlyArray<{ id: string; document: BroadcastGraphicConfig }>,
	linked: ReadonlyArray<{ id: string; name: string }>,
): Promise<void> {
	await assertGraphicsTemplatesReferencesSelectable(
		library,
		rewrites.map(rewrite => ({
			name: linked.find(template => template.id === rewrite.id)?.name ?? rewrite.id,
			references: broadcastGraphicsGraphicAssetReferences({
				graphics: [rewrite.document],
			}),
		})),
		'Broadcast Graphic Template',
	);
}
