import type { GraphicsAssetLibrary } from '~~/server/modules/graphics-asset-library';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import { assertGraphicsTemplateReferencesSelectable } from '~~/server/utils/graphicsTemplateReferences';
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
		broadcastGraphicsGraphicAssetReferences({ graphics: [document] }),
		'Broadcast Graphic Template',
	);
}
